// External fixture plugin that fails while its module loads.
export {};

throw new Error("plugin exploded at load");
