import {
  createDefaultCoreModule,
  createDefaultSharedCoreModule,
  inject,
  type LangiumCoreServices,
  type LangiumSharedCoreServices
} from "langium";
import { NodeFileSystem } from "langium/node";
import { ShapeGeneratedModule, ShapeGeneratedSharedModule } from "./generated/module.ts";

export type ShapeServices = {
  shared: LangiumSharedCoreServices;
  Shape: LangiumCoreServices;
};

let cachedServices: ShapeServices | undefined;

export function createShapeServices(): ShapeServices {
  if (cachedServices) {
    return cachedServices;
  }

  const shared = inject(createDefaultSharedCoreModule(NodeFileSystem), ShapeGeneratedSharedModule);
  const Shape = inject(createDefaultCoreModule({ shared }), ShapeGeneratedModule);

  shared.ServiceRegistry.register(Shape);
  void shared.workspace.ConfigurationProvider.initialized({});

  cachedServices = { shared, Shape };
  return cachedServices;
}
