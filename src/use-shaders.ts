import { Skia, type SkRuntimeEffect } from "@shopify/react-native-skia";
import React from "react";
import { SHADERS, buildSource, shaderById, type ShaderDef } from "./shaders";

export type Compiled = {
  effect: SkRuntimeEffect | null;
  /** Message renvoye par Skia : c'est la seule facon de lire une erreur SKSL. */
  error: string | null;
};

/**
 * Compilation de toute la bibliotheque. `Skia.RuntimeEffect.Make` renvoie null
 * quand le SKSL est refuse et leve pour les erreurs de JSI, donc les deux sont
 * captures : un shader mort doit etre visible, pas vider l'ecran.
 */
export const compileEffects = (defs: ShaderDef[] = SHADERS): Map<string, Compiled> => {
  const out = new Map<string, Compiled>();
  for (const def of defs) {
    try {
      const effect = Skia.RuntimeEffect.Make(buildSource(def));
      out.set(
        def.id,
        effect
          ? { effect, error: null }
          : { effect: null, error: "RuntimeEffect.Make a renvoye null" },
      );
    } catch (e) {
      out.set(def.id, {
        effect: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
};

/** Toute la bibliotheque, compilee une fois. C'est ce que regarde la grille. */
export const useCompiledEffects = (): Map<string, Compiled> =>
  React.useMemo(() => compileEffects(), []);

/**
 * Un seul shader, compile a la demande — pour un projet qui n'affiche qu'un effet
 * et n'a aucune raison d'en compiler vingt-cinq.
 */
export const useShaderEffect = (id: string): Compiled =>
  React.useMemo(() => {
    const def = shaderById(id);
    if (!def) {
      return { effect: null, error: `Aucun shader nomme "${id}" dans la bibliotheque.` };
    }
    return compileEffects([def]).get(def.id) ?? { effect: null, error: "compilation avortee" };
  }, [id]);
