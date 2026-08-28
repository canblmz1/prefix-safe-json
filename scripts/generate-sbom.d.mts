export interface ProductionDependencyNode {
  version: string;
  path: string;
  resolved?: string;
  dependencies?: Record<string, ProductionDependencyNode>;
}

export interface ProductionDependencyTree extends ProductionDependencyNode {
  name: string;
}

export interface CycloneDxComponent {
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  scope?: "required";
  purl: string;
  licenses?: Array<{ license: { id: string } } | { expression: string }>;
  externalReferences?: Array<{ type: "distribution"; url: string }>;
}

export interface CycloneDxBom {
  $schema: string;
  bomFormat: "CycloneDX";
  specVersion: "1.6";
  version: 1;
  metadata: {
    tools: { components: Array<{ type: "application"; name: string; version: string }> };
    component: CycloneDxComponent;
    properties: Array<{ name: string; value: string }>;
  };
  components: CycloneDxComponent[];
  dependencies: Array<{ ref: string; dependsOn: string[] }>;
}

export function readProductionDependencyTree(): ProductionDependencyTree;
export function buildCycloneDx(
  root: ProductionDependencyTree,
  manifestLoader?: (packagePath: string) => { license?: string },
): CycloneDxBom;
export function serializeCycloneDx(bom: CycloneDxBom): string;
export function defaultSbomPath(version: string): string;
export function parseOutputPathArgument(argv: string[]): string | undefined;
