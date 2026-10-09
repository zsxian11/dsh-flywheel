/** Projection key shared by the Host registration and the Client reader.
 * Kept dependency-free so importing it never pulls Host-only modules into the
 * browser bundle. */

/** Session projection key the graph tab reads with `useProjection`. */
export const GRAPH_PROJECTION_KEY = 'flywheelGraph'
