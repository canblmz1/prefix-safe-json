import { describe, expect, it } from "vitest";
import { buildCycloneDx, serializeCycloneDx } from "../../scripts/generate-sbom.mjs";

const manifests: Record<string, { license: string }> = {
  "/root": { license: "MIT OR Apache-2.0" },
  "/ajv": { license: "MIT" },
  "/leaf": { license: "BSD-3-Clause" },
};

const tree = {
  name: "prefix-safe-json",
  version: "0.4.2",
  path: "/root",
  dependencies: {
    ajv: {
      version: "8.20.0",
      path: "/ajv",
      resolved: "https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz",
      dependencies: {
        "fast-uri": { version: "3.1.5", path: "/leaf" },
      },
    },
  },
};

describe("production SBOM", () => {
  it("emits a deterministic CycloneDX graph without development dependencies or local paths", () => {
    const loadManifest = (path: string) => {
      const manifest = manifests[path];
      if (!manifest) throw new Error(`missing fixture manifest for ${path}`);
      return manifest;
    };
    const first = buildCycloneDx(tree, loadManifest);
    const second = buildCycloneDx(tree, loadManifest);

    expect(serializeCycloneDx(first)).toBe(serializeCycloneDx(second));
    expect(first).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1 });
    expect(first.metadata.component.licenses).toEqual([{ expression: "MIT OR Apache-2.0" }]);
    expect(first.components.map((component) => component.name)).toEqual(["ajv", "fast-uri"]);
    expect(first.dependencies).toContainEqual({
      ref: "pkg:npm/prefix-safe-json@0.4.2",
      dependsOn: ["pkg:npm/ajv@8.20.0"],
    });
    expect(serializeCycloneDx(first)).not.toContain("/root");
  });
});
