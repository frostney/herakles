declare module "*.html" {
  const file: import("bun").HTMLBundle;
  export default file;
}
