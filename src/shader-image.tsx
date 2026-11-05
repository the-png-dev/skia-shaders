// skia-verify:allow useDerivedValue  (hook Reanimated, pas Skia)
import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  useImage,
  type SkImage,
} from "@shopify/react-native-skia";
import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { packUniforms, shaderById, type ShaderDef } from "./shaders";
import { useShaderEffect, type Compiled } from "./use-shaders";

/** Ce que <Shader> de Skia accepte : un objet fige, ou une shared value d'objet. */
export type Uniforms = Record<string, number | number[]>;
export type UniformsInput = Uniforms | SharedValue<Uniforms>;

export type Fit =
  | "contain"
  | "cover"
  | "fill"
  | "fitWidth"
  | "fitHeight"
  | "none"
  | "scaleDown";

/**
 * Le noeud de rendu. Il ne dessine **que** la forme pleine du canvas courant :
 * c'est la structure verifiee sur l'appareil, et la seule que ce paquet garantit.
 *
 * Un `<Rect><Paint><Shader>` equivalent ne rend rien (constate sur la grille :
 * les shaders compilait, l'ecran restait noir). Le `<Group>` parent doit donc
 * porter le translate **et** le clip de la cellule, et `resolution` doit valoir la
 * taille de la cellule, pas celle du canvas.
 *
 * Sans effet compile, la source est posee telle quelle : un shader mort montre
 * l'image plutot qu'une dalle vide.
 */
export const ShaderLayer = ({
  compiled,
  image,
  width,
  height,
  uniforms,
  fit = "cover",
}: {
  compiled: Compiled | undefined;
  image: SkImage | null;
  width: number;
  height: number;
  uniforms?: UniformsInput;
  fit?: Fit;
}) => (
  <Fill>
    {compiled?.effect ? (
      <Shader source={compiled.effect} uniforms={uniforms}>
        <ImageShader
          image={image}
          x={0}
          y={0}
          width={width}
          height={height}
          fit={fit}
        />
      </Shader>
    ) : (
      <ImageShader
        image={image}
        x={0}
        y={0}
        width={width}
        height={height}
        fit={fit}
      />
    )}
  </Fill>
);

/**
 * L'image seule, effet compris : un canvas, une source, un shader de la
 * bibliotheque. Les reglages se passent dans l'ordre de declaration des curseurs
 * (`def.sliders`), ce qui evite d'ecrire un nom d'uniform a la main.
 *
 * Pour animer, ne pas passer par ici : construire son propre `useDerivedValue`
 * avec `packUniforms` et le donner a `<ShaderLayer uniforms>`. Ce composant-ci est
 * fait pour un rendu fige ou pilote par l'etat React.
 */
export const ShaderImage = ({
  shader,
  source,
  width,
  height,
  values,
  split = 0,
  time = 0,
  fit = "cover",
  style,
}: {
  shader: ShaderDef | string;
  source: string | number | { uri: string };
  width: number;
  height: number;
  values?: number[];
  /** Fraction (0..1) de largeur laissee intacte a gauche : le wipe de comparaison. */
  split?: number;
  time?: number;
  fit?: Fit;
  style?: StyleProp<ViewStyle>;
}) => {
  const def = typeof shader === "string" ? shaderById(shader) : shader;
  const compiled = useShaderEffect(def?.id ?? "");
  const image = useImage(source as number);
  const uniforms = def
    ? packUniforms(def, values ?? [], { width, height, split, time })
    : undefined;

  return (
    <Canvas style={[{ width, height }, style]}>
      <ShaderLayer
        compiled={compiled}
        image={image}
        width={width}
        height={height}
        uniforms={uniforms}
        fit={fit}
      />
    </Canvas>
  );
};
