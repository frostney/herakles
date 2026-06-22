declare module "*.html" {
  const file: import("bun").HTMLBundle;
  export default file;
}

declare module "*.png" {
  const file: string;
  export default file;
}
