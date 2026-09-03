/** CSS-module import shim for the bundle's own styles. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
