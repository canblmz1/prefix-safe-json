import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function encodePurlName(name) {
  if (!name.startsWith("@")) return encodeURIComponent(name);
  const separator = name.indexOf("/");
  if (separator === -1) throw new Error(`invalid scoped npm package name: ${name}`);
  return `${encodeURIComponent(name.slice(0, separator))}/${encodeURIComponent(name.slice(separator + 1))}`;
}

function purl(name, version) {
  return `pkg:npm/${encodePurlName(name)}@${encodeURIComponent(version)}`;
}

function licenseChoice(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (/^[A-Za-z0-9-.+]+$/u.test(value)) return [{ license: { id: value } }];
  return [{ expression: value }];
}

function defaultManifestLoader(packagePath) {
  return JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
}

export function readProductionDependencyTree() {
  const args = ["list", "--prod", "--depth", "Infinity", "--json"];
  const output = process.platform === "win32"
    ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `pnpm ${args.join(" ")}`], {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
      })
    : execFileSync("pnpm", args, { cwd: PROJECT_ROOT, encoding: "utf8" });
  const rows = JSON.parse(output);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`expected one pnpm project, received ${Array.isArray(rows) ? rows.length : "non-array"}`);
  }
  return rows[0];
}

export function buildCycloneDx(root, manifestLoader = defaultManifestLoader) {
  if (!root || typeof root.name !== "string" || typeof root.version !== "string") {
    throw new Error("pnpm production tree is missing the root package identity");
  }

  const components = new Map();
  const dependencyEdges = new Map();

  function visit(name, node) {
    if (!node || typeof node.version !== "string" || typeof node.path !== "string") {
      throw new Error(`production dependency ${name} is missing version or install path`);
    }
    const ref = purl(name, node.version);
    const children = Object.entries(node.dependencies ?? {}).sort(([left], [right]) => left.localeCompare(right));
    const childRefs = children.map(([childName, child]) => visit(childName, child));
    const priorEdges = dependencyEdges.get(ref);
    if (priorEdges && JSON.stringify(priorEdges) !== JSON.stringify(childRefs)) {
      throw new Error(`conflicting dependency edges for ${ref}`);
    }
    dependencyEdges.set(ref, childRefs);

    if (!components.has(ref)) {
      const manifest = manifestLoader(node.path);
      const component = {
        type: "library",
        "bom-ref": ref,
        name,
        version: node.version,
        scope: "required",
        purl: ref,
      };
      const licenses = licenseChoice(manifest.license);
      if (licenses) component.licenses = licenses;
      if (typeof node.resolved === "string") {
        component.externalReferences = [{ type: "distribution", url: node.resolved }];
      }
      components.set(ref, component);
    }
    return ref;
  }

  const rootManifest = manifestLoader(root.path);
  const rootRef = purl(root.name, root.version);
  const rootDependencies = Object.entries(root.dependencies ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, node]) => visit(name, node));
  dependencyEdges.set(rootRef, rootDependencies);

  const rootComponent = {
    type: "library",
    "bom-ref": rootRef,
    name: root.name,
    version: root.version,
    purl: rootRef,
  };
  const rootLicenses = licenseChoice(rootManifest.license);
  if (rootLicenses) rootComponent.licenses = rootLicenses;

  return {
    $schema: "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      tools: {
        components: [{ type: "application", name: "prefix-safe-json-sbom-generator", version: "1" }],
      },
      component: rootComponent,
      properties: [
        { name: "prefix-safe-json:dependency-scope", value: "production" },
        { name: "prefix-safe-json:dependency-source", value: "pnpm frozen install" },
      ],
    },
    components: [...components.values()].sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"])),
    dependencies: [...dependencyEdges.entries()]
      .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() }))
      .sort((left, right) => left.ref.localeCompare(right.ref)),
  };
}

export function serializeCycloneDx(bom) {
  return `${JSON.stringify(bom, null, 2)}\n`;
}

export function defaultSbomPath(version) {
  return resolve(PROJECT_ROOT, "artifacts", `prefix-safe-json-${version}.cdx.json`);
}

export function parseOutputPathArgument(argv) {
  const args = argv.slice(2);
  if (args[0] === "--") args.shift();
  if (args.length > 1) throw new Error("expected at most one SBOM output path");
  return args[0];
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    const tree = readProductionDependencyTree();
    const output = resolve(parseOutputPathArgument(process.argv) ?? defaultSbomPath(tree.version));
    const bom = buildCycloneDx(tree);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, serializeCycloneDx(bom));
    process.stdout.write(`${JSON.stringify({ result: "PASS", format: "CycloneDX 1.6 JSON", output })}\n`);
  } catch (error) {
    process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
