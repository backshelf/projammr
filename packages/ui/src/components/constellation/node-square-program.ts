import type { Attributes } from "graphology-types";
import { NodePointProgram } from "sigma/rendering";

/** Fills the whole point sprite rather than cutting a disc out of it. In
 *  picking mode the vertex shader hands over the node's id as its colour, so
 *  the hit area is the same square. */
const FRAGMENT_SHADER_SOURCE = /* glsl */ `
precision mediump float;

varying vec4 v_color;

void main(void) {
  gl_FragColor = v_color;
}
`;

/**
 * A node drawn as a square: sigma's own point program, whose sprite is
 * already a square the size of the node's diameter, with the fragment shader
 * that trims it to a circle swapped for one that fills it.
 */
export class NodeSquareProgram<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
> extends NodePointProgram<N, E, G> {
  getDefinition() {
    return { ...super.getDefinition(), FRAGMENT_SHADER_SOURCE };
  }
}
