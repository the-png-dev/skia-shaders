// Bibliotheque de shaders du Playground.
//
// Ce fichier ne doit JAMAIS importer Skia : ce ne sont que des chaines et des
// nombres, donc Node peut le verifier sans appareil (scripts/tests/
// verify-shader-playground.mjs). La compilation `Skia.RuntimeEffect.Make` se fait
// cote ecran, dans use-effects.ts.
//
// Chaque shader ne fournit qu'une fonction `fx(vec2 pos)` : l'entete et le `main`
// sont communs, et c'est le `main` qui gere le wipe de comparaison. Un shader
// n'a donc jamais a savoir qu'il est compare.

export type Slider = {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
};

export type ShaderGroup = "couleur" | "forme" | "lumiere" | "texture" | "fluide";

/** Ordre d'affichage du filtre de grille. */
export const GROUPS: { id: ShaderGroup; label: string }[] = [
  { id: "couleur", label: "Couleur" },
  { id: "forme", label: "Forme" },
  { id: "lumiere", label: "Lumiere" },
  { id: "texture", label: "Texture" },
  { id: "fluide", label: "Fluide" },
];

export type ShaderDef = {
  id: string;
  label: string;
  group: ShaderGroup;
  note: string;
  /** Vrai si le corps lit `time` : l'horloge doit alors etre diffuse par frame. */
  animated?: boolean;
  /** Vrai si le corps lit `pointer` / `progress` : l'hote doit les animer au toucher. */
  touch?: boolean;
  sliders: Slider[];
  body: string;
};

/**
 * Uniforms fournis par l'hote, jamais par un curseur. `pointer` et `progress` ne
 * servent qu'aux shaders marques `touch`, mais ils sont declares partout : un
 * uniform non utilise disparait de la liste de l'effet, donc le servir ne coute rien.
 */
export const HOST_UNIFORMS = ["resolution", "split", "time", "pointer", "progress"] as const;

/**
 * `image` n'est pas un float : c'est l'enfant <ImageShader> du <Shader> qui le
 * fournit. Il n'apparait donc pas dans l'objet `uniforms`, mais il doit etre
 * declare dans la source.
 */
export const CHILD_UNIFORMS = ["image"] as const;

/**
 * Vitesse de l'horloge globale, en fois le temps reel. Elle est integree cote UI
 * (`clock += dt * vitesse`) et non multipliee dans le shader : un shader qui
 * calculait `time * vitesse` faisait sauter la phase a chaque coup de curseur.
 */
export const CLOCK_BAND = {
  min: 0,
  max: 3,
  step: 0.05,
  def: 1,
  digits: 2,
  unit: "\u00d7",
};

const HEAD = `
uniform shader image;
uniform vec2 resolution;
uniform float split;
uniform float time;
uniform vec2 pointer;
uniform float progress;
`;

// `split` est la fraction (0..1) de largeur laissee intacte : a gauche du wipe on
// voit la source, a droite l'effet. Sans ce cote a cote, regler un curseur sur une
// image inconnue ne veut rien dire.
const MAIN = `
half4 main(vec2 pos) {
  half4 src = image.eval(pos);
  if (pos.x <= split * resolution.x) {
    return src;
  }
  return fx(pos);
}
`;

const LUMA = "vec3(0.2126, 0.7152, 0.0722)";

export const SHADERS: ShaderDef[] = [
  {
    id: "grayscale",
    label: "Niveaux de gris",
    group: "couleur",
    note: "Luminance Rec. 709, pas la moyenne des trois canaux.",
    sliders: [
      { name: "amount", label: "Melange", min: 0, max: 1, step: 0.01, def: 1 },
    ],
    body: `
half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  float l = dot(c.rgb, ${LUMA});
  return half4(mix(c.rgb, vec3(l), amount), c.a);
}
`,
  },
  {
    id: "sepia",
    label: "Sepia",
    group: "couleur",
    note: "Melange pondere des canaux : la saturation n'est pas corrigee, d'ou le jaune.",
    sliders: [
      { name: "amount", label: "Melange", min: 0, max: 1, step: 0.01, def: 1 },
    ],
    body: `
half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  vec3 sep = vec3(
    clamp(0.393 * c.r + 0.769 * c.g + 0.189 * c.b, 0.0, 1.0),
    clamp(0.349 * c.r + 0.686 * c.g + 0.168 * c.b, 0.0, 1.0),
    clamp(0.272 * c.r + 0.534 * c.g + 0.131 * c.b, 0.0, 1.0)
  );
  return half4(mix(c.rgb, sep, amount), c.a);
}
`,
  },
  {
    id: "duotone",
    label: "Bichromie",
    group: "couleur",
    note: "La luminance traverse deux couleurs imposees ; contraste deplace le point milieu.",
    sliders: [
      { name: "contrast", label: "Contraste", min: 0.2, max: 3, step: 0.05, def: 1 },
      { name: "amount", label: "Melange", min: 0, max: 1, step: 0.01, def: 1 },
    ],
    body: `
half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  float l = dot(c.rgb, ${LUMA});
  l = clamp((l - 0.5) * contrast + 0.5, 0.0, 1.0);
  vec3 shadow = vec3(0.05, 0.15, 0.28);
  vec3 light = vec3(1.0, 0.82, 0.45);
  return half4(mix(c.rgb, mix(shadow, light, l), amount), c.a);
}
`,
  },
  {
    id: "thermal",
    label: "Thermique",
    group: "couleur",
    note: "Faux couleurs a cinq paliers : c'est la rampe qui fait l'effet, pas la luminance.",
    sliders: [
      { name: "gain", label: "Gain", min: 0.2, max: 3, step: 0.05, def: 1 },
      { name: "amount", label: "Melange", min: 0, max: 1, step: 0.01, def: 1 },
    ],
    body: `
vec3 ramp(float t) {
  vec3 c0 = vec3(0.02, 0.02, 0.09);
  vec3 c1 = vec3(0.10, 0.20, 0.75);
  vec3 c2 = vec3(0.75, 0.15, 0.65);
  vec3 c3 = vec3(1.00, 0.55, 0.10);
  vec3 c4 = vec3(1.00, 1.00, 0.90);
  float seg = clamp(t, 0.0, 0.9999);
  if (seg < 0.25) { return mix(c0, c1, seg / 0.25); }
  if (seg < 0.50) { return mix(c1, c2, (seg - 0.25) / 0.25); }
  if (seg < 0.75) { return mix(c2, c3, (seg - 0.50) / 0.25); }
  return mix(c3, c4, (seg - 0.75) / 0.25);
}

half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  float l = clamp((dot(c.rgb, ${LUMA}) - 0.5) * gain + 0.5, 0.0, 1.0);
  return half4(mix(c.rgb, ramp(l), amount), c.a);
}
`,
  },
  {
    id: "posterize",
    label: "Quantification",
    group: "couleur",
    note: "Niveaux par canal, arrondis au plus proche. Sous 4 niveaux le banding devient le sujet.",
    sliders: [
      { name: "levels", label: "Niveaux", min: 2, max: 24, step: 1, def: 6 },
    ],
    body: `
half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  float n = max(2.0, levels);
  vec3 q = floor(c.rgb * n + 0.5) / n;
  return half4(q, c.a);
}
`,
  },
  {
    id: "pixelate",
    label: "Mosaique",
    group: "forme",
    note: "Echantillonnage au centre de cellule : la maille est ancoree sur l'origine du canvas, pas sur l'image.",
    sliders: [
      { name: "cell", label: "Cellule", min: 2, max: 64, step: 1, def: 14, unit: "px" },
    ],
    body: `
half4 fx(vec2 pos) {
  float s = max(1.0, cell);
  vec2 p = floor(pos / s) * s + s * 0.5;
  return image.eval(p);
}
`,
  },
  {
    id: "lens",
    label: "Objectif",
    group: "forme",
    note: "Distorsion radiale : positif gonfle au centre, negative pince. Hors cadre = transparent.",
    sliders: [
      { name: "k", label: "Courbure", min: -0.6, max: 1.2, step: 0.01, def: 0.45 },
    ],
    body: `
half4 fx(vec2 pos) {
  vec2 cc = pos / resolution - 0.5;
  float r2 = dot(cc, cc);
  vec2 p = (cc * (1.0 + k * r2 * 4.0) + 0.5) * resolution;
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return half4(0.0, 0.0, 0.0, 0.0);
  }
  return image.eval(p);
}
`,
  },
  {
    id: "ripple",
    label: "Onde",
    group: "forme",
    animated: true,
    note: "Deplacement radial sinusoide. Aucun reglage de vitesse ici : l'horloge est globale et integree, donc la phase ne saute jamais.",
    sliders: [
      { name: "amp", label: "Amplitude", min: 0, max: 60, step: 0.5, def: 18, unit: "px" },
      { name: "freq", label: "Frequence", min: 0.005, max: 0.12, step: 0.001, def: 0.035 },
    ],
    body: `
half4 fx(vec2 pos) {
  vec2 c = resolution * 0.5;
  float d = distance(pos, c);
  vec2 dir = d > 0.001 ? (pos - c) / d : vec2(0.0);
  float phase = d * freq - time * 6.2831853;
  vec2 p = pos + dir * sin(phase) * amp;
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return image.eval(pos);
  }
  return image.eval(p);
}
`,
  },
  {
    id: "chroma",
    label: "Aberration",
    group: "forme",
    note: "Un echantillon par canal a des rayons differents : l'effet est forcement nul au centre. Sans repli sur l'echantillon central, le canal de bord tombe a zero et le cadre verdit.",
    sliders: [
      { name: "spread", label: "Ecart", min: 0, max: 40, step: 0.5, def: 12, unit: "px" },
      { name: "fall", label: "Chute", min: 0.2, max: 3, step: 0.05, def: 1 },
    ],
    body: `
half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  vec2 off = pos - resolution * 0.5;
  float d = length(off);
  vec2 dir = d > 0.001 ? off / d : vec2(1.0, 0.0);
  float r = length(resolution) * 0.5;
  float t = clamp(d / max(r, 1.0), 0.0, 1.0);
  float s = spread * pow(t, fall);
  vec2 pa = pos + dir * s;
  vec2 pb = pos - dir * s;
  // Hors cadre, eval rend transparent : sans repli sur l'echantillon central, le
  // canal de bord tombe a 0 et il reste le vert et le bleu seuls — d'ou la frange
  // cyan en haut et verte a gauche. Le test de cadre est la garde qui marche deja
  // dans les deplacements ; recadrer la coordonnee ne suffisait pas.
  float cr = (pa.x < 0.0 || pa.y < 0.0 || pa.x > resolution.x || pa.y > resolution.y)
    ? c.r
    : image.eval(pa).r;
  float cb = (pb.x < 0.0 || pb.y < 0.0 || pb.x > resolution.x || pb.y > resolution.y)
    ? c.b
    : image.eval(pb).b;
  return half4(cr, c.g, cb, c.a);
}
`,
  },
  {
    id: "kaleido",
    label: "Kaleidoscope",
    group: "forme",
    animated: true,
    note: "Repli angulaire autour du centre, secteur impair = couture visible. rotation est un decalage fige, la rotation vient de l'horloge globale.",
    sliders: [
      { name: "segments", label: "Secteurs", min: 2, max: 16, step: 1, def: 6 },
      { name: "rotation", label: "Rotation", min: -1, max: 1, step: 0.01, def: 0.1 },
    ],
    body: `
half4 fx(vec2 pos) {
  vec2 c = resolution * 0.5;
  vec2 off = pos - c;
  float seg = max(2.0, segments);
  float slice = 6.2831853 / seg;
  float a = atan(off.y, off.x) + rotation * 3.14159265 + time * 0.62831853;
  float aa = abs(mod(a, slice) - slice * 0.5);
  vec2 p = c + vec2(cos(aa), sin(aa)) * length(off);
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return image.eval(pos);
  }
  return image.eval(p);
}
`,
  },
  {
    id: "sobel",
    label: "Contours",
    group: "lumiere",
    note: "9 echantillons, noyau separable. Le pas entre echantillons decide du niveau de detail detecte ; a 0 les contours sont blancs sur fond noir.",
    sliders: [
      { name: "gap", label: "Pas", min: 1, max: 8, step: 0.5, def: 1.6, unit: "px" },
      { name: "amount", label: "Intensite", min: 0, max: 3, step: 0.05, def: 1.4 },
      { name: "invert", label: "Inversion", min: 0, max: 1, step: 0.01, def: 0 },
    ],
    body: `
float luma(vec2 p) {
  // Recadrage composante par composante avant echantillonner : sans lui, les taps
  // qui sortent du cadre reviennent transparents et la difference avec l'interieur
  // dessine un contour artificiel autour de toute l'image.
  vec2 q = p;
  q.x = min(max(q.x, 0.0), resolution.x - 1.0);
  q.y = min(max(q.y, 0.0), resolution.y - 1.0);
  return dot(image.eval(q).rgb, ${LUMA});
}

half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  float w = gap;
  float tl = luma(pos + vec2(-w, -w));
  float tc = luma(pos + vec2(0.0, -w));
  float tr = luma(pos + vec2(w, -w));
  float ml = luma(pos + vec2(-w, 0.0));
  float mr = luma(pos + vec2(w, 0.0));
  float bl = luma(pos + vec2(-w, w));
  float bc = luma(pos + vec2(0.0, w));
  float br = luma(pos + vec2(w, w));
  float dx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float dy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  float m = clamp(length(vec2(dx, dy)) * amount, 0.0, 1.0);
  m = mix(m, 1.0 - m, invert);
  return half4(vec3(m), c.a);
}
`,
  },
  {
    id: "bloom",
    label: "Halo",
    group: "lumiere",
    note: "Passe haute luminance moyennee sur 25 points puis additive. Seul le seuil compte vraiment.",
    sliders: [
      { name: "threshold", label: "Seuil", min: 0.2, max: 1, step: 0.01, def: 0.62 },
      { name: "radius", label: "Rayon", min: 1, max: 12, step: 0.5, def: 5, unit: "px" },
      { name: "strength", label: "Gain", min: 0, max: 2, step: 0.05, def: 0.9 },
    ],
    body: `
half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  vec3 glow = vec3(0.0);
  float total = 0.0;
  for (int i = -2; i <= 2; i += 1) {
    for (int j = -2; j <= 2; j += 1) {
      float wgt = max(1.0 - length(vec2(float(i), float(j))) * 0.22, 0.0);
      vec2 p = pos + vec2(float(i), float(j)) * radius;
      glow += max(image.eval(p).rgb - vec3(threshold), vec3(0.0)) * wgt;
      total += wgt;
    }
  }
  glow = glow / max(total, 1.0);
  return half4(min(c.rgb + glow * strength, vec3(1.0)), c.a);
}
`,
  },
  {
    id: "film",
    label: "Argentique",
    group: "lumiere",
    animated: true,
    note: "Vignettage, grain bruiteur de position, chauffe des hautes lumieres. Le grain bouge a chaque frame.",
    sliders: [
      { name: "vig", label: "Vignette", min: 0, max: 1, step: 0.01, def: 0.65 },
      { name: "grain", label: "Grain", min: 0, max: 0.35, step: 0.005, def: 0.12 },
      { name: "warm", label: "Chauffe", min: 0, max: 1, step: 0.01, def: 0.4 },
    ],
    body: `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  float d = length(pos / resolution - 0.5);
  float falloff = 1.0 - smoothstep(0.22, 0.85, d);
  vec3 col = c.rgb * mix(1.0, falloff, vig);
  float n = hash21(pos + vec2(time * 37.0, time * 11.0)) - 0.5;
  col += n * grain;
  float l = clamp(dot(col, ${LUMA}), 0.0, 1.0);
  col = mix(col, col * vec3(1.06, 0.98, 0.86), warm * l);
  return half4(clamp(col, 0.0, 1.0), c.a);
}
`,
  },
  {
    id: "scanlines",
    label: "Tele cathodique",
    group: "texture",
    animated: true,
    note: "Galbe, lignes horizontales et bandeau de balayage. Le balayage est ce qui prouve que time avance.",
    sliders: [
      { name: "lines", label: "Densite lignes", min: 0.1, max: 1.2, step: 0.01, def: 0.6 },
      { name: "roll", label: "Balayage", min: 0, max: 1, step: 0.01, def: 0.35 },
      { name: "curve", label: "Galbe", min: 0, max: 0.25, step: 0.005, def: 0.08 },
    ],
    body: `
half4 fx(vec2 pos) {
  vec2 uv = (pos / resolution) * 2.0 - 1.0;
  vec2 bulged = uv * (1.0 + vec2(uv.y * uv.y, uv.x * uv.x) * curve);
  vec2 p = (bulged * 0.5 + 0.5) * resolution;
  if (abs(bulged.x) > 1.0 || abs(bulged.y) > 1.0) {
    return half4(0.0, 0.0, 0.0, 1.0);
  }
  half4 c = image.eval(p);
  float scan = 0.5 + 0.5 * sin(pos.y * lines * 6.2831853);
  float band = 1.0 - smoothstep(0.0, 0.25, abs(fract(p.y / resolution.y - time * 0.4) - 0.5));
  vec3 col = c.rgb * mix(1.0, scan, 0.55) * (1.0 - roll * 0.6 * band);
  return half4(col, 1.0);
}
`,
  },
  {
    id: "halftone",
    label: "Trame offset",
    group: "texture",
    note: "Un point par cellule, rayon fonction de l'inverse de la luminance. Seule trame volontairement opaque : le papier remplace le fond.",
    sliders: [
      { name: "cell", label: "Pas", min: 4, max: 34, step: 1, def: 12, unit: "px" },
      { name: "density", label: "Densite", min: 0.2, max: 1.8, step: 0.02, def: 1.1 },
      { name: "angle", label: "Angle", min: 0, max: 1.57, step: 0.01, def: 0.35, unit: "rad" },
    ],
    body: `
half4 fx(vec2 pos) {
  float s = max(4.0, cell);
  float ca = cos(angle);
  float sa = sin(angle);
  mat2 rot = mat2(ca, sa, -sa, ca);
  vec2 rp = rot * pos;
  vec2 g = floor(rp / s) * s + s * 0.5;
  vec2 ip = rot * g;
  vec3 src = image.eval(ip).rgb;
  float l = clamp(1.0 - dot(src, ${LUMA}), 0.0, 1.0);
  // Plancher sous 0.75 reviendrait a edge0 == edge1 dans smoothstep : division par zero.
  float r = max(0.75, s * 0.62 * sqrt(clamp(l * density, 0.0, 1.0)));
  float a = 1.0 - smoothstep(max(r - 1.5, 0.0), r, length(rp - g));
  return half4(mix(vec3(0.98, 0.97, 0.94), src, a), 1.0);
}
`,
  },

  // --- Le lot anime : bruit de valeur, deplacements et lumieres qui bougent. ---
  // Regle commune a tous : la vitesse n'est jamais un curseur. `time` arrive deja
  // multiplie par l'horloge globale integree, donc aucun reglage ne fait sauter la
  // phase — seuls l'amplitude et le dessin bougent.

  {
    id: "aurore",
    label: "Aurore",
    group: "fluide",
    animated: true,
    note: "Rideaux de bruit fBm a cinq octaves, additionnes sur l'image. C'est le seuil du rideau qui fait la forme, pas la couleur.",
    sliders: [
      { name: "curtain", label: "Rideau", min: 0.1, max: 1.4, step: 0.02, def: 0.75 },
      { name: "glow", label: "Lueur", min: 0, max: 1.5, step: 0.02, def: 0.8 },
    ],
    body: `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i += 1) {
    s += vnoise(p) * amp;
    p = p * 2.03 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return s;
}

half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  vec2 uv = pos / resolution;
  float n = fbm(vec2(uv.x * 3.0, uv.y * 1.8 - time * 0.22));
  // Le bruit fBm oscille autour de 0,5 : le seuil doit rester dans cette plage.
  // En dessous, tout se couvre et l'effet vire au voile lave ; au-dessus, plus rien.
  float cut = 0.72 - curtain * 0.3;
  float band = smoothstep(cut, cut + 0.2, n);
  vec3 col = mix(vec3(0.10, 0.95, 0.55), vec3(0.42, 0.25, 0.95),
                 clamp(uv.y + n * 0.4, 0.0, 1.0));
  return half4(min(c.rgb + col * band * glow, vec3(1.0)), c.a);
}
`,
  },
  {
    id: "caustics",
    label: "Caustiques",
    group: "fluide",
    animated: true,
    note: "Trois ondes qui se croisent : la concentration de lumiere est la puissance quatrieme de leur somme, et l'echantillon suit le gradient de la somme.",
    sliders: [
      { name: "bend", label: "Refractation", min: 0, max: 30, step: 0.5, def: 12, unit: "px" },
      { name: "strength", label: "Eclat", min: 0, max: 2, step: 0.02, def: 1 },
    ],
    body: `
half4 fx(vec2 pos) {
  vec2 uv = pos / resolution;
  float t = time * 0.6;
  float a = (uv.x * 9.0 + t) * 6.2831853;
  float b = (uv.y * 7.0 - t * 0.8) * 6.2831853;
  float c2 = (uv.x + uv.y) * 12.0 + t * 1.3;
  float w = sin(a) + sin(b) + sin(c2);
  float focus = pow(abs(w) / 3.0, 4.0);
  vec2 g = vec2(cos(a) * 9.0 + cos(c2) * 12.0, cos(b) * 7.0 + cos(c2) * 12.0);
  vec2 p = pos + g * bend * 0.04;
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return image.eval(pos);
  }
  half4 c = image.eval(p);
  vec3 col = c.rgb * (0.72 + focus * strength)
           + vec3(0.75, 0.92, 1.0) * focus * strength;
  return half4(min(col, vec3(1.0)), c.a);
}
`,
  },
  {
    id: "vortex",
    label: "Vortex",
    group: "forme",
    animated: true,
    note: "Rotation angulaire en k^2 : le centre tourne, le bord reste. La rotation vient de l'horloge, le torsion ne fait que decaler la vis.",
    sliders: [
      { name: "twist", label: "Torsion", min: -8, max: 8, step: 0.1, def: 3.2 },
      { name: "radius", label: "Portee", min: 0.15, max: 1.2, step: 0.01, def: 0.75 },
    ],
    body: `
half4 fx(vec2 pos) {
  vec2 mid = resolution * 0.5;
  vec2 off = pos - mid;
  float d = length(off);
  float rad = max(resolution.x * radius, 1.0);
  float k = 1.0 - clamp(d / rad, 0.0, 1.0);
  float a = atan(off.y, off.x) + twist * k * k * 0.5 + time * k * k * 1.4;
  vec2 p = mid + vec2(cos(a), sin(a)) * d;
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return image.eval(pos);
  }
  return image.eval(p);
}
`,
  },
  {
    id: "shock",
    label: "Onde de choc",
    group: "forme",
    animated: true,
    note: "Un front qui part du centre et ressort, en boucle. Le profil est un sinus replie : le deplacement revient a zero des qu'il sort de l'anneau.",
    sliders: [
      { name: "amp", label: "Amplitude", min: 0, max: 70, step: 1, def: 28, unit: "px" },
      { name: "ring", label: "Largeur", min: 20, max: 220, step: 2, def: 90, unit: "px" },
    ],
    body: `
half4 fx(vec2 pos) {
  vec2 mid = resolution * 0.5;
  float span = length(resolution) * 0.75;
  float head = fract(time * 0.28) * (span + ring);
  float d = distance(pos, mid);
  float k = clamp(1.0 - abs(d - head) / max(ring, 1.0), 0.0, 1.0);
  vec2 dir = d > 0.001 ? (pos - mid) / d : vec2(0.0);
  vec2 p = pos + dir * sin(k * 3.14159265) * amp;
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return image.eval(pos);
  }
  half4 c = image.eval(p);
  return half4(min(c.rgb + vec3(1.0, 0.95, 0.85) * k * k * 0.22, vec3(1.0)), c.a);
}
`,
  },
  {
    id: "drops",
    label: "Gouttes",
    group: "forme",
    animated: true,
    note: "Une goutte par cellule, chacune a sa voie et sa vitesse tirees d'un hash de grille. La lentille comprime vers son centre, elle ne zoome pas.",
    sliders: [
      { name: "cell", label: "Pas", min: 16, max: 80, step: 1, def: 38, unit: "px" },
      { name: "squeeze", label: "Compression", min: 0, max: 30, step: 0.5, def: 12, unit: "px" },
    ],
    body: `
float hash1(float n) {
  return fract(sin(n) * 43758.5453);
}

half4 fx(vec2 pos) {
  float s = max(10.0, cell);
  vec2 g = floor(pos / s);
  float seed = g.x * 73.1 + g.y * 17.7;
  float lane = hash1(seed);
  float fall = fract(time * (0.05 + hash1(seed + 3.0) * 0.12));
  vec2 ctr = (g + vec2(0.25 + lane * 0.5, fall)) * s;
  vec2 dv = pos - ctr;
  float d = length(dv);
  float rad = s * 0.3;
  if (d > rad) {
    return image.eval(pos);
  }
  vec2 dir = d > 0.001 ? dv / d : vec2(0.0);
  float k = 1.0 - d / max(rad, 0.001);
  vec2 p = pos - dir * k * squeeze;
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return image.eval(pos);
  }
  half4 c = image.eval(p);
  float hi = pow(k, 3.0) * 0.5;
  return half4(min(c.rgb + vec3(hi), vec3(1.0)), c.a);
}
`,
  },
  {
    id: "bokeh",
    label: "Bokeh",
    group: "lumiere",
    animated: true,
    note: "Quarante disques flous toujours evalues, dont seuls les `count` premiers comptent : une boucle a borne constante, parce que SKSL ne borne pas un nombre d'iterations a un uniform.",
    sliders: [
      { name: "count", label: "Particules", min: 4, max: 40, step: 1, def: 16 },
      { name: "size", label: "Taille", min: 0.2, max: 1.6, step: 0.02, def: 0.9 },
      { name: "glow", label: "Lueur", min: 0, max: 1, step: 0.02, def: 0.5 },
    ],
    body: `
float hash1(float n) {
  return fract(sin(n) * 43758.5453);
}

half4 fx(vec2 pos) {
  half4 c = image.eval(pos);
  float acc = 0.0;
  for (int i = 0; i < 40; i += 1) {
    float fi = float(i);
    float on = step(fi, count - 1.0);
    float bx = hash1(fi * 12.9898 + 1.0);
    float by = hash1(fi * 78.233 + 2.0);
    float sp = 0.25 + hash1(fi * 3.7 + 3.0) * 0.75;
    float xx = fract(bx + sin(time * 0.25 + fi) * 0.03);
    float yy = fract(by - time * 0.04 * sp);
    vec2 bp = vec2(xx * resolution.x, yy * resolution.y);
    float br = (10.0 + hash1(fi * 5.1 + 4.0) * 34.0) * size;
    float dd = distance(pos, bp);
    acc += (1.0 - smoothstep(br * 0.15, br, dd)) * on;
  }
  vec3 col = c.rgb + vec3(1.0, 0.93, 0.76) * acc * glow * 0.35;
  return half4(min(col, vec3(1.0)), c.a);
}
`,
  },
  {
    id: "cells",
    label: "Cellules",
    group: "texture",
    animated: true,
    note: "Voronoï a neuf recherches de voisinage, dont les points oscillent sur un cercle. L'arete est la difference des deux distances les plus proches.",
    sliders: [
      { name: "scale", label: "Densite", min: 2, max: 14, step: 0.5, def: 6 },
      { name: "width", label: "Fissure", min: 0.03, max: 0.4, step: 0.01, def: 0.12 },
      { name: "glow", label: "Brasier", min: 0, max: 1.5, step: 0.02, def: 0.9 },
    ],
    body: `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2v(vec2 p) {
  return vec2(hash12(p), hash12(p + vec2(7.3, 2.1)));
}

half4 fx(vec2 pos) {
  vec2 uv = pos / resolution * scale * vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 gi = floor(uv);
  vec2 gf = fract(uv);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int oy = -1; oy <= 1; oy += 1) {
    for (int ox = -1; ox <= 1; ox += 1) {
      vec2 o = vec2(float(ox), float(oy));
      vec2 hp = hash2v(gi + o);
      hp += 0.35 * vec2(sin(time * 0.7 + hp.x * 6.2831853),
                        cos(time * 0.6 + hp.y * 6.2831853));
      float dd = length(hp + o - gf);
      if (dd < d1) {
        d2 = d1;
        d1 = dd;
      } else if (dd < d2) {
        d2 = dd;
      }
    }
  }
  float edge = d2 - d1;
  float line = 1.0 - smoothstep(0.0, max(width, 0.01), edge);
  float pulse = 0.5 + 0.5 * sin(time * 1.5 + d1 * 6.0);
  half4 c = image.eval(pos);
  vec3 lava = mix(vec3(0.65, 0.05, 0.0), vec3(1.0, 0.72, 0.12), pulse);
  vec3 col = c.rgb * (1.0 - line * 0.75) + lava * line * glow;
  return half4(min(col, vec3(1.0)), c.a);
}
`,
  },
  {
    id: "glitch",
    label: "Glitch",
    group: "texture",
    animated: true,
    note: "Le temps est quantifie en huit pas par seconde : sans cela le deplacement glisserait en continu au lieu de claquer. Seules les lignes tirées au sort bougent.",
    sliders: [
      { name: "amount", label: "Probabilite", min: 0.02, max: 1, step: 0.02, def: 0.35 },
      { name: "shift", label: "Deplacement", min: 0, max: 90, step: 1, def: 30, unit: "px" },
      { name: "band", label: "Hauteur de ligne", min: 4, max: 60, step: 1, def: 18, unit: "px" },
    ],
    body: `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

half4 fx(vec2 pos) {
  float row = floor(pos.y / max(band, 1.0));
  float tick = floor(time * 8.0);
  float rnd = hash12(vec2(row, tick));
  float jump = step(1.0 - amount, rnd) * (rnd - 0.5) * 2.0 * shift;
  vec2 p = pos + vec2(jump, 0.0);
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return image.eval(pos);
  }
  half4 c = image.eval(p);
  float split = abs(jump) * 0.4;
  float rx = min(max(p.x + split, 0.0), resolution.x - 1.0);
  float bx = min(max(p.x - split, 0.0), resolution.x - 1.0);
  vec3 col = vec3(image.eval(vec2(rx, p.y)).r, c.g, image.eval(vec2(bx, p.y)).b);
  col += vec3(hash12(vec2(pos.x * 0.7, tick))) * step(0.93, rnd) * 0.25;
  return half4(clamp(col, vec3(0.0), vec3(1.0)), c.a);
}
`,
  },
  {
    id: "neon",
    label: "Néon",
    group: "lumiere",
    animated: true,
    note: "Quatre echantillons suffisent pour l'arete, le luxe c'est la teinte qui parcourt l'image : elle depend de y et du temps, donc la couleur descend.",
    sliders: [
      { name: "strength", label: "Detection", min: 0.2, max: 4, step: 0.05, def: 2 },
      { name: "glow", label: "Halo", min: 0, max: 2, step: 0.02, def: 1 },
      { name: "dim", label: "Fond", min: 0, max: 1, step: 0.02, def: 0.25 },
    ],
    body: `
float lumaAt(vec2 p) {
  vec2 q = p;
  q.x = min(max(q.x, 0.0), resolution.x - 1.0);
  q.y = min(max(q.y, 0.0), resolution.y - 1.0);
  return dot(image.eval(q).rgb, ${LUMA});
}

vec3 hsv(float h) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), vec3(6.0)) - 3.0) - 1.0,
                   vec3(0.0), vec3(1.0));
  return rgb * rgb * (3.0 - 2.0 * rgb);
}

half4 fx(vec2 pos) {
  float w = 1.6;
  float dx = lumaAt(pos + vec2(w, 0.0)) - lumaAt(pos - vec2(w, 0.0));
  float dy = lumaAt(pos + vec2(0.0, w)) - lumaAt(pos - vec2(0.0, w));
  float m = clamp(length(vec2(dx, dy)) * strength, 0.0, 1.0);
  float hue = fract(pos.y / resolution.y * 0.5 + time * 0.08);
  half4 c = image.eval(pos);
  vec3 col = c.rgb * dim + hsv(hue) * m * glow;
  return half4(min(col, vec3(1.0)), c.a);
}
`,
  },
  {
    id: "lens2",
    label: "Loupe",
    group: "forme",
    animated: true,
    note: "Une sphere qui suit une lemniscate : l'interieur comprime, la couronne etire jusqu'a 1,18 rayon. Le bord est le seul endroit ou l'on re-echantillonne au-dela.",
    sliders: [
      { name: "size", label: "Rayon", min: 0.06, max: 0.4, step: 0.01, def: 0.2 },
      { name: "zoom", label: "Compression", min: 0.25, max: 0.95, step: 0.01, def: 0.5 },
      { name: "light", label: "Reflet", min: 0, max: 0.8, step: 0.02, def: 0.35 },
    ],
    body: `
half4 fx(vec2 pos) {
  vec2 ctr = vec2(0.5 + 0.3 * sin(time * 0.62),
                  0.5 + 0.26 * sin(time * 0.94 + 1.0)) * resolution;
  float rad = max(resolution.x * size, 2.0);
  vec2 dv = pos - ctr;
  float d = length(dv);
  if (d > rad) {
    return image.eval(pos);
  }
  vec2 dir = d > 0.001 ? dv / d : vec2(0.0);
  float k = d / rad;
  float map = k < 0.85 ? k * zoom : mix(zoom, 1.18, (k - 0.85) / 0.15);
  vec2 p = ctr + dir * map * rad;
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return image.eval(pos);
  }
  half4 c = image.eval(p);
  float spec = pow(max(0.0, 1.0 - abs(k - 0.35) * 3.0), 3.0) * light;
  float rim = smoothstep(0.86, 1.0, k) * (1.0 - smoothstep(1.0, 1.02, k));
  return half4(min(c.rgb + vec3(spec) + vec3(rim * 0.25), vec3(1.0)), c.a);
}
`,
  },

  {
    id: "magnify",
    label: "Loupe tactile",
    group: "forme",
    touch: true,
    note: "Le verre grossit au centre et relache vers le bord : l'echelle passe de 1/zoom a 1 en k^2, donc la circonference ne montre aucune couture. Hors du disque, l'image reste exactement elle-meme.",
    sliders: [
      { name: "radius", label: "Rayon", min: 40, max: 200, step: 2, def: 104, unit: "px" },
      { name: "zoom", label: "Grossissement", min: 1, max: 6, step: 0.05, def: 2.4, unit: "x" },
      { name: "glint", label: "Reflet", min: 0, max: 0.6, step: 0.01, def: 0.26 },
    ],
    body: `
half4 fx(vec2 pos) {
  half4 src = image.eval(pos);
  vec2 d = pos - pointer;
  float dist = length(d);
  float rad = max(radius, 8.0);

  // Le talus : un leger assombrissement juste hors du disque, qui donne au verre
  // son epaisseur sans toucher aux pixels.
  if (dist > rad) {
    float skirt = 1.0 - smoothstep(rad, rad * 1.22, dist);
    return half4(src.rgb * (1.0 - skirt * 0.35), src.a);
  }

  float k = dist / rad;
  float s = mix(1.0 / zoom, 1.0, k * k);
  vec2 p = pointer + d * s;
  if (p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y) {
    return src;
  }
  half4 g = image.eval(p);
  vec2 hl = d / rad - vec2(0.34, 0.38);
  float spec = (1.0 - smoothstep(0.0, 0.42, length(hl))) * glint;
  float rim = smoothstep(0.90, 0.985, k) * (1.0 - smoothstep(0.985, 1.0, k));
  vec3 col = g.rgb * mix(1.0, 1.07, k) + vec3(spec) + vec3(rim * 0.5);
  return half4(min(col, vec3(1.0)), src.a);
}
`,
  },

  {
    id: "mosaic",
    label: "Mosaique tactile",
    group: "texture",
    touch: true,
    note: "Au repos l'image est reconstituee. Une touche relance le front depuis le doigt : les tuiles traverses redeviennent opaques et exactes, les autres montrent une autre region de l'image et se dezoquent.",
    sliders: [
      { name: "cell", label: "Tuile", min: 10, max: 70, step: 1, def: 26, unit: "px" },
      { name: "scramble", label: "Egarement", min: 0, max: 1, step: 0.02, def: 0.85 },
    ],
    body: `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

half4 fx(vec2 pos) {
  float s = max(8.0, cell);
  vec2 g = floor(pos / s);
  vec2 local = fract(pos / s) - 0.5;
  vec2 ctr = (g + 0.5) * s;
  float r1 = hash12(g);
  float r2 = hash12(g + vec2(3.7, 8.2));

  // Portee : la distance du doigt au coin le plus lointain, avec une marge pour la
  // traine des tuiles. Un reach fige sur la diagonale ferait tout basculer avant
  // 40 % de la montee, et les deux tiers restants de l'animation ne montreraient rien.
  float far = length(vec2(
    max(pointer.x, resolution.x - pointer.x),
    max(pointer.y, resolution.y - pointer.y)
  )) * 1.35;
  float d = distance(ctr, pointer);
  float front = progress * far;
  // Le petit retard propre a chaque tuile evite le mur net : la frontiere
  // traverse la mosaique tuile par tuile. La marge ci-dessus est calculee pour
  // qu'a progress = 1 la plus lointaine des tuiles soit retournee, sinon l'image
  // ne revient jamais vraiment a son etat de repos.
  float k = clamp((front - d - r1 * s * 1.2) / max(s * 0.8, 1.0), 0.0, 1.0);

  vec2 anchor = mix(ctr, vec2(r1, r2) * resolution, scramble * (1.0 - k));
  float zoom = mix(1.3, 1.0, k);
  vec2 q = anchor + local * s * zoom;
  vec4 src;
  if (q.x < 0.0 || q.y < 0.0 || q.x > resolution.x || q.y > resolution.y) {
    src = image.eval(pos);
  } else {
    src = image.eval(q);
  }

  vec3 col = src.rgb * mix(0.42, 1.0, k);
  float grout = smoothstep(0.40, 0.5, max(abs(local.x), abs(local.y)));
  col = mix(col, vec3(0.02, 0.03, 0.05), grout * (1.0 - k) * 0.85);
  float band = exp(-((d - front) * (d - front)) / (far * far * 0.0025));
  col += vec3(1.0, 0.94, 0.82) * band * 0.55;
  return half4(min(col, vec3(1.0)), src.a);
}
`,
  },
];

export const shaderById = (id: string): ShaderDef | undefined =>
  SHADERS.find((s) => s.id === id);

/** Les curseurs sont tous des `uniform float` : la declaration est derivee de la spec. */
export const sliderDeclarations = (def: ShaderDef): string =>
  def.sliders.map((s) => `uniform float ${s.name};`).join("\n");

export const buildSource = (def: ShaderDef): string =>
  `${HEAD}\n${sliderDeclarations(def)}\n${def.body}\n${MAIN}\n`;

/**
 * Noms des uniforms que Skia reclamera. `processUniforms` leve une exception si un
 * uniform declare dans la source manque dans la prop `uniforms` — d'ou cette liste,
 * qui est le contrat entre la source et l'hote.
 */
export const uniformNames = (source: string): string[] => {
  const names: string[] = [];
  const re = /uniform\s+(?:shader|float|vec2|vec3|vec4|int)\s+(\w+)\s*;/g;
  let m = re.exec(source);
  while (m !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
    m = re.exec(source);
  }
  return names;
};

export const declaredUniforms = (def: ShaderDef): string[] => uniformNames(buildSource(def));

export const sliderNames = (def: ShaderDef): string[] => def.sliders.map((s) => s.name);

/**
 * Nombre de curseurs qu'un shader peut exposer. L'ecran cree une shared value par
 * slot, ecrite a la main : un `useSharedValue` par element d'une liste de longueur
 * variable est interdit, donc la capacite est declaree ici et le test verifie
 * qu'aucun shader ne la depasse.
 */
export const SLOT_COUNT = 3;

/**
 * Bande telle que l'entend le curseur reutilisable du projet AI Orb. `digits` est
 * derive du pas : un pas de 0,05 affiche 2 decimales, un pas de 1 aucune — un
 * champ `digits` ecrit a la main finirait par contredire son propre pas.
 */
export const toBand = (slider: Slider) => {
  const digits =
    slider.step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(slider.step)));
  return {
    min: slider.min,
    max: slider.max,
    step: slider.step,
    def: slider.def,
    digits,
    ...(slider.unit ? { unit: slider.unit } : {}),
  };
};

/**
 * Valeurs des slots quand on veut l'effet tel qu'ecrit. Les slots sont recycles
 * d'un shader a l'autre, donc le reset n'est pas un objet nomme : c'est une liste
 * de longueur SLOT_COUNT, completee par 0 sous le nombre reel de curseurs.
 */
export const defaultSlots = (def: ShaderDef): number[] => {
  const out: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) out.push(def.sliders[i]?.def ?? 0);
  return out;
};

/**
 * Objet `uniforms` tel que le recoit <Shader>. `slots[i]` porte la valeur du
 * curseur `def.sliders[i]` ; un trou tombe sur la valeur par defaut, ce qui est
 * aussi la facon de demander « tous reglages par defaut » en passant `[]`.
 * Un nom en trop est ignore par Skia, donc servir `time` a un shader statique est
 * sans effet.
 *
 * Appele depuis un worklet (l'horloge tourne sur le thread UI) : d'ou la directive,
 * l'absence de spread et de `??`, et `resolution` en couple de nombres.
 */
export const packUniforms = (
  def: ShaderDef,
  slots: number[],
  host: {
    width: number;
    height: number;
    split: number;
    time: number;
    pointer?: number[];
    progress?: number;
  }
): Record<string, number | number[]> => {
  "worklet";
  const out: Record<string, number | number[]> = {};
  out.resolution = [host.width, host.height];
  out.split = host.split;
  out.time = host.time;
  // Au repos, un shader tactile est deja resolu : pointer au centre, progress a 1.
  out.pointer = host.pointer === undefined
    ? [host.width * 0.5, host.height * 0.5]
    : host.pointer;
  out.progress = host.progress === undefined ? 1 : host.progress;
  for (let i = 0; i < def.sliders.length; i += 1) {
    const s = def.sliders[i];
    const v = slots[i];
    out[s.name] = typeof v === "number" ? v : s.def;
  }
  return out;
};
