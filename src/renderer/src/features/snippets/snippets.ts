export interface Snippet {
  name: string;
  description: string;
  /** Packages the snippet needs in the preamble. */
  packages?: string[];
  /** LaTeX to insert. The cursor lands at "$0". */
  tex: string;
}

export const DEFAULT_SNIPPETS: Snippet[] = [
  {
    name: 'Table',
    description: 'Three column table with booktabs rules',
    packages: ['booktabs'],
    tex: String.raw`\begin{table}[htbp]
  \centering
  \caption{$0}
  \label{tab:}
  \begin{tabular}{lcc}
    \toprule
    Variable & (1) & (2) \\
    \midrule
    A & 0.00 & 0.00 \\
    B & 0.00 & 0.00 \\
    \bottomrule
  \end{tabular}
\end{table}
`,
  },
  {
    name: 'Table with notes',
    description: 'Table with a note line under it',
    packages: ['booktabs', 'threeparttable'],
    tex: String.raw`\begin{table}[htbp]
  \centering
  \caption{$0}
  \label{tab:}
  \begin{threeparttable}
    \begin{tabular}{lcc}
      \toprule
      Variable & (1) & (2) \\
      \midrule
      A & 0.00 & 0.00 \\
      B & 0.00 & 0.00 \\
      \bottomrule
    \end{tabular}
    \begin{tablenotes}[flushleft]
      \footnotesize
      \item \textit{Notes:} 
    \end{tablenotes}
  \end{threeparttable}
\end{table}
`,
  },
  {
    name: 'Figure',
    description: 'Single centered image with caption',
    packages: ['graphicx'],
    tex: String.raw`\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\linewidth]{$0}
  \caption{}
  \label{fig:}
\end{figure}
`,
  },
  {
    name: 'Figure with subfigures',
    description: 'Two images side by side, each with a caption',
    packages: ['graphicx', 'subcaption'],
    tex: String.raw`\begin{figure}[htbp]
  \centering
  \begin{subfigure}[b]{0.48\linewidth}
    \centering
    \includegraphics[width=\linewidth]{$0}
    \caption{}
    \label{fig:sub-a}
  \end{subfigure}
  \hfill
  \begin{subfigure}[b]{0.48\linewidth}
    \centering
    \includegraphics[width=\linewidth]{}
    \caption{}
    \label{fig:sub-b}
  \end{subfigure}
  \caption{}
  \label{fig:}
\end{figure}
`,
  },
  {
    name: 'Bulleted list',
    description: 'itemize environment',
    tex: String.raw`\begin{itemize}
  \item $0
  \item 
\end{itemize}
`,
  },
  {
    name: 'Numbered list',
    description: 'enumerate environment',
    tex: String.raw`\begin{enumerate}
  \item $0
  \item 
\end{enumerate}
`,
  },
  {
    name: 'Numbered equation',
    description: 'Equation with a label',
    packages: ['amsmath'],
    tex: String.raw`\begin{equation}
  $0
  \label{eq:}
\end{equation}
`,
  },
  {
    name: 'Aligned equations',
    description: 'Multi-line derivation aligned at =',
    packages: ['amsmath'],
    tex: String.raw`\begin{align}
  $0 &= \\
  &= 
\end{align}
`,
  },
  {
    name: 'Theorem and proof',
    description: 'Theorem statement followed by a proof',
    packages: ['amsthm'],
    tex: String.raw`\begin{theorem}\label{thm:}
  $0
\end{theorem}
\begin{proof}
  
\end{proof}
`,
  },
  {
    name: 'Side by side columns',
    description: 'Two minipages',
    tex: String.raw`\begin{minipage}[t]{0.48\linewidth}
  $0
\end{minipage}
\hfill
\begin{minipage}[t]{0.48\linewidth}
  
\end{minipage}
`,
  },
  {
    name: 'Section with label',
    description: 'Section heading and cross-reference label',
    tex: String.raw`\section{$0}
\label{sec:}
`,
  },
  {
    name: 'Footnote',
    description: 'Footnote at the cursor',
    tex: String.raw`\footnote{$0}`,
  },
];
