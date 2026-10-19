export interface MathSymbol {
  /** LaTeX inserted into the document. The cursor goes at "$0", else inside the first "{}". */
  tex: string;
  /** What the palette shows; falls back to the LaTeX when there is no glyph. */
  glyph?: string;
  /** Package that provides the command, when it is not plain LaTeX. */
  package?: string;
}
export interface SymbolGroup {
  name: string;
  /** Wider buttons, for text labels such as environment names. */
  wide?: boolean;
  symbols: MathSymbol[];
}

/** "tex glyph" pairs, optionally "tex glyph package". */
function list(source: string): MathSymbol[] {
  return source
    .trim()
    .split(/\s*\n\s*/)
    .flatMap((line) => line.split(/\s{2,}/))
    .filter(Boolean)
    .map((entry) => {
      const [tex, glyph, pkg] = entry.split(' ');
      return {
        tex: tex!,
        ...(glyph && glyph !== '-' ? { glyph } : {}),
        ...(pkg ? { package: pkg } : {}),
      };
    });
}

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    name: 'Environments',
    wide: true,
    symbols: [
      ...[
        ['equation', 'amsmath'],
        ['equation*', 'amsmath'],
        ['align', 'amsmath'],
        ['align*', 'amsmath'],
        ['aligned', 'amsmath'],
        ['gather', 'amsmath'],
        ['gather*', 'amsmath'],
        ['multline', 'amsmath'],
        ['split', 'amsmath'],
        ['cases', 'amsmath'],
        ['array', ''],
        ['matrix', 'amsmath'],
        ['pmatrix', 'amsmath'],
        ['bmatrix', 'amsmath'],
        ['vmatrix', 'amsmath'],
        ['Vmatrix', 'amsmath'],
        ['smallmatrix', 'amsmath'],
      ].map(([name, pkg]) => ({
        tex: `\\begin{${name}}\n  $0\n\\end{${name}}`,
        glyph: name,
        ...(pkg ? { package: pkg } : {}),
      })),
      { tex: '$$0$', glyph: 'inline $ $' },
      { tex: '\\[\n  $0\n\\]', glyph: 'display \\[ \\]' },
    ],
  },
  {
    name: 'Structures',
    symbols: [
      { tex: '\\frac{}{}', glyph: 'a⁄b' },
      { tex: '\\sqrt{}', glyph: '√x' },
      { tex: '\\sqrt[n]{}', glyph: 'ⁿ√x' },
      { tex: 'x^{}', glyph: 'xⁿ' },
      { tex: 'x_{}', glyph: 'xₙ' },
      { tex: 'x_{}^{}', glyph: 'xₙᵐ' },
      { tex: '\\sum_{i=1}^{n}', glyph: '∑ᵢⁿ' },
      { tex: '\\prod_{i=1}^{n}', glyph: '∏ᵢⁿ' },
      { tex: '\\int_{a}^{b}', glyph: '∫ₐᵇ' },
      { tex: '\\lim_{x \\to \\infty}', glyph: 'lim' },
      { tex: '\\binom{}{}', glyph: '(ⁿₖ)', package: 'amsmath' },
      { tex: '\\left( $0 \\right)', glyph: '( )' },
      { tex: '\\left[ $0 \\right]', glyph: '[ ]' },
      { tex: '\\left\\{ $0 \\right\\}', glyph: '{ }' },
      { tex: '\\left| $0 \\right|', glyph: '| |' },
      { tex: '\\left\\| $0 \\right\\|', glyph: '‖ ‖' },
      { tex: '\\text{}', glyph: 'txt', package: 'amsmath' },
      { tex: '\\mathbb{}', glyph: 'ℝ', package: 'amssymb' },
      { tex: '\\mathcal{}', glyph: '𝒜', package: 'amssymb' },
      { tex: '\\mathbf{}', glyph: '𝐱' },
    ],
  },
  {
    name: 'Greek lowercase',
    symbols: list(`
      \\alpha α  \\beta β  \\gamma γ  \\delta δ  \\epsilon ϵ  \\varepsilon ε  \\zeta ζ  \\eta η
      \\theta θ  \\vartheta ϑ  \\iota ι  \\kappa κ  \\lambda λ  \\mu μ  \\nu ν  \\xi ξ
      \\pi π  \\varpi ϖ  \\rho ρ  \\varrho ϱ  \\sigma σ  \\varsigma ς  \\tau τ  \\upsilon υ
      \\phi ϕ  \\varphi φ  \\chi χ  \\psi ψ  \\omega ω
    `),
  },
  {
    name: 'Greek uppercase',
    symbols: list(`
      \\Gamma Γ  \\Delta Δ  \\Theta Θ  \\Lambda Λ  \\Xi Ξ  \\Pi Π  \\Sigma Σ  \\Upsilon Υ
      \\Phi Φ  \\Psi Ψ  \\Omega Ω
    `),
  },
  {
    name: 'Operators',
    symbols: list(`
      + +  - −  \\pm ±  \\mp ∓  \\times ×  \\div ÷  \\cdot ·  \\ast ∗  \\star ⋆  \\circ ∘
      \\bullet ∙  \\oplus ⊕  \\ominus ⊖  \\otimes ⊗  \\oslash ⊘  \\odot ⊙  \\cap ∩  \\cup ∪
      \\uplus ⊎  \\sqcap ⊓  \\sqcup ⊔  \\vee ∨  \\wedge ∧  \\setminus ∖  \\wr ≀  \\dagger †
      \\ddagger ‡  \\amalg ⨿  \\triangleleft ◁  \\triangleright ▷  \\diamond ⋄  \\bigcirc ◯
    `),
  },
  {
    name: 'Relations',
    symbols: list(`
      = =  \\neq ≠  < <  > >  \\leq ≤  \\geq ≥  \\ll ≪  \\gg ≫  \\approx ≈  \\equiv ≡
      \\sim ∼  \\simeq ≃  \\cong ≅  \\propto ∝  \\perp ⊥  \\parallel ∥  \\mid ∣  \\nmid ∤
      \\prec ≺  \\succ ≻  \\preceq ⪯  \\succeq ⪰  \\subset ⊂  \\supset ⊃  \\subseteq ⊆
      \\supseteq ⊇  \\in ∈  \\notin ∉  \\ni ∋  \\vdash ⊢  \\models ⊨  \\asymp ≍  \\doteq ≐
      \\leqslant ⩽ amssymb  \\geqslant ⩾ amssymb  \\nleq ≰ amssymb  \\ngeq ≱ amssymb
      \\lesssim ≲ amssymb  \\gtrsim ≳ amssymb  \\subsetneq ⊊ amssymb  \\supsetneq ⊋ amssymb
    `),
  },
  {
    name: 'Arrows',
    symbols: list(`
      \\leftarrow ←  \\rightarrow →  \\leftrightarrow ↔  \\Leftarrow ⇐  \\Rightarrow ⇒
      \\Leftrightarrow ⇔  \\uparrow ↑  \\downarrow ↓  \\updownarrow ↕  \\Uparrow ⇑
      \\Downarrow ⇓  \\mapsto ↦  \\longmapsto ⟼  \\longrightarrow ⟶  \\longleftarrow ⟵
      \\Longrightarrow ⟹  \\Longleftarrow ⟸  \\Longleftrightarrow ⟺  \\to →  \\gets ←
      \\hookrightarrow ↪  \\hookleftarrow ↩  \\nearrow ↗  \\searrow ↘  \\swarrow ↙
      \\nwarrow ↖  \\rightsquigarrow ⇝ amssymb  \\rightleftharpoons ⇌  \\leadsto ⇝ amssymb
      \\xrightarrow{} → amsmath
    `),
  },
  {
    name: 'Big operators',
    symbols: list(`
      \\sum ∑  \\prod ∏  \\coprod ∐  \\int ∫  \\iint ∬ amsmath  \\iiint ∭ amsmath  \\oint ∮
      \\bigcup ⋃  \\bigcap ⋂  \\bigsqcup ⨆  \\bigvee ⋁  \\bigwedge ⋀  \\bigoplus ⨁
      \\bigotimes ⨂  \\bigodot ⨀  \\biguplus ⨄
    `),
  },
  {
    name: 'Sets and logic',
    symbols: list(`
      \\emptyset ∅  \\varnothing ∅ amssymb  \\forall ∀  \\exists ∃  \\nexists ∄ amssymb
      \\neg ¬  \\lnot ¬  \\land ∧  \\lor ∨  \\top ⊤  \\bot ⊥  \\therefore ∴ amssymb
      \\because ∵ amssymb  \\mathbb{N} ℕ amssymb  \\mathbb{Z} ℤ amssymb
      \\mathbb{Q} ℚ amssymb  \\mathbb{R} ℝ amssymb  \\mathbb{C} ℂ amssymb
      \\mathbb{P} ℙ amssymb  \\mathbb{E} 𝔼 amssymb  \\complement ∁ amssymb
    `),
  },
  {
    name: 'Calculus and misc',
    symbols: list(`
      \\infty ∞  \\partial ∂  \\nabla ∇  \\hbar ℏ  \\ell ℓ  \\Re ℜ  \\Im ℑ  \\aleph ℵ
      \\wp ℘  \\prime ′  \\angle ∠  \\triangle △  \\square □ amssymb  \\surd √
      \\imath ı  \\jmath ȷ  \\flat ♭  \\natural ♮  \\sharp ♯  \\clubsuit ♣  \\diamondsuit ♢
      \\heartsuit ♡  \\spadesuit ♠  \\checkmark ✓ amssymb  \\degree ° gensymb
    `),
  },
  {
    name: 'Dots',
    symbols: list(`
      \\ldots …  \\cdots ⋯  \\vdots ⋮  \\ddots ⋱  \\dotsc … amsmath  \\dotsb ⋯ amsmath
    `),
  },
  {
    name: 'Delimiters',
    symbols: list(`
      ( (  ) )  [ [  ] ]  \\{ {  \\} }  \\langle ⟨  \\rangle ⟩  \\lfloor ⌊  \\rfloor ⌋
      \\lceil ⌈  \\rceil ⌉  | |  \\| ‖  \\lvert | amsmath  \\rvert | amsmath
      \\lVert ‖ amsmath  \\rVert ‖ amsmath  / /  \\backslash ∖
    `),
  },
  {
    name: 'Accents and decorations',
    symbols: [
      { tex: '\\hat{}', glyph: 'x̂' },
      { tex: '\\bar{}', glyph: 'x̄' },
      { tex: '\\tilde{}', glyph: 'x̃' },
      { tex: '\\vec{}', glyph: 'x⃗' },
      { tex: '\\dot{}', glyph: 'ẋ' },
      { tex: '\\ddot{}', glyph: 'ẍ' },
      { tex: '\\widehat{}', glyph: 'x̂̂' },
      { tex: '\\widetilde{}', glyph: 'x̃̃' },
      { tex: '\\overline{}', glyph: 'x̅' },
      { tex: '\\underline{}', glyph: 'x̲' },
      { tex: '\\overbrace{}^{}', glyph: '⏞' },
      { tex: '\\underbrace{}_{}', glyph: '⏟' },
      { tex: '\\overrightarrow{}', glyph: 'AB→' },
      { tex: '\\stackrel{}{}', glyph: 'a=b' },
    ],
  },
  {
    name: 'Functions',
    symbols: list(`
      \\sin sin  \\cos cos  \\tan tan  \\cot cot  \\sec sec  \\csc csc  \\arcsin arcsin
      \\arccos arccos  \\arctan arctan  \\sinh sinh  \\cosh cosh  \\tanh tanh  \\log log
      \\ln ln  \\exp exp  \\lim lim  \\limsup limsup  \\liminf liminf  \\max max  \\min min
      \\sup sup  \\inf inf  \\arg arg  \\det det  \\dim dim  \\ker ker  \\deg deg  \\gcd gcd
      \\Pr Pr  \\hom hom  \\operatorname{} op amsmath
    `),
  },
  {
    name: 'Spacing',
    symbols: [
      { tex: '\\,', glyph: 'thin' },
      { tex: '\\:', glyph: 'med' },
      { tex: '\\;', glyph: 'thick' },
      { tex: '\\!', glyph: 'neg' },
      { tex: '\\quad', glyph: 'quad' },
      { tex: '\\qquad', glyph: 'qquad' },
    ],
  },
];

/** Resolves the text to insert and where the cursor lands inside it. */
export function insertion(tex: string): { text: string; caret: number } {
  const marker = tex.indexOf('$0');
  if (marker !== -1) return { text: tex.replace('$0', ''), caret: marker };
  const braces = tex.indexOf('{}');
  return { text: tex, caret: braces === -1 ? tex.length : braces + 1 };
}
