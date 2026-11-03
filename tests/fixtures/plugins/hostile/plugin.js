// External fixture plugin whose export throws on every read.
export default new Proxy(
  {},
  {
    get() {
      throw new Error("hostile export");
    },
    ownKeys() {
      throw new Error("hostile export keys");
    },
  },
);
