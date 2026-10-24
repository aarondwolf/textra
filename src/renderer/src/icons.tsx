import { forwardRef, useId, type CSSProperties, type ReactElement } from 'react';
import { IconBase, type IconProps, type IconWeight } from '@phosphor-icons/react';

// A single chat-and-sparkles glyph, using the same context, sizes and weights as the rail.
const aiChatWeights = new Map<IconWeight, ReactElement>(
  (['thin', 'light', 'regular', 'bold', 'fill', 'duotone'] as const).map((weight) => [
    weight,
    <g
      transform="translate(4 4) scale(10)"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight === 'bold' ? 2 : weight === 'thin' ? 1 : 1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M11 4H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3v4l5-4h5a3 3 0 0 0 3-3v-3"
        fill={weight === 'duotone' || weight === 'fill' ? 'currentColor' : 'none'}
        fillOpacity=".18"
      />
      <path d="m17 1 1.5 3.5L22 6l-3.5 1.5L17 11l-1.5-3.5L12 6l3.5-1.5Z" />
      <path d="m22 10 .6 1.4L24 12l-1.4.6L22 14l-.6-1.4L20 12l1.4-.6Z" strokeWidth="1.1" />
    </g>,
  ]),
);
export const AIChat = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
  <IconBase ref={ref} {...props} weights={aiChatWeights} />
));
AIChat.displayName = 'AIChat';

export function MarkdownLogo({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}): ReactElement {
  const height = Math.round((size * 128) / 208);
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 208 128"
      className={className}
      aria-hidden="true"
      fill="currentColor"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <rect
        x="5"
        y="5"
        width="198"
        height="118"
        rx="16"
        ry="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
      />
      <path d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39z" />
      <path d="M148 98l-26-26h16V30h20v42h16z" />
    </svg>
  );
}

export function TextraLogo({
  size = 48,
  variant = 'auto',
  className,
}: {
  size?: number;
  variant?: 'auto' | 'light' | 'dark' | 'safe-white' | 'safe-dark';
  className?: string;
}): ReactElement {
  let darkFill = 'var(--logo-dark-accent, #9bc9bb)';
  let lightFill = 'var(--logo-light-accent, #ffffff)';

  if (variant === 'light') {
    darkFill = '#9bc9bb';
    lightFill = '#ffffff';
  } else if (variant === 'dark') {
    darkFill = '#1c1e20';
    lightFill = '#293e37';
  } else if (variant === 'safe-white') {
    darkFill = '#979c9e';
    lightFill = '#ffffff';
  } else if (variant === 'safe-dark') {
    darkFill = '#000000';
    lightFill = '#404446';
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="matrix(2.0687985,0,0,2.0687985,-547.09256,-547.22567)">
        <path
          fill={darkFill}
          d="m 429.119,348.289 c 15.526,0.112 28.521,6.138 37.864,18.973 5.54,7.61 9.492,18.023 13.675,26.642 l 23.783,48.773 72.793,149.672 c 7.889,16.578 15.942,33.079 24.157,49.499 5.92,12.089 10.382,21.746 17.032,33.559 -13.17,-0.501 -29.275,1.224 -41.641,-2.182 -8.01,-2.206 -19.089,-9.416 -23.606,-16.363 -3.971,-6.108 -8.311,-16.52 -11.753,-23.464 L 509.67,567.985 430.416,405.167 c -9.026,-18.25 -18.27,-38.993 -27.558,-56.724 -6.579,8.75 -18.824,32.186 -21.935,43.26 -1.227,4.367 -1.179,15.882 -1.171,20.897 l 0.075,29.405 c 0.017,7.443 0.246,16.192 -0.87,23.456 -0.943,6.255 -2.852,12.326 -5.659,17.995 -8.016,15.952 -18.659,22.208 -34.812,27.454 8.045,2.03 14.189,5.646 20.712,10.603 20.204,16.959 20.837,33.101 20.721,57.928 l -0.111,33.215 c 0.095,27.84 5.172,38.806 21.947,61.08 4.227,-5.887 12.685,-22.517 16.936,-29.833 l 36.292,-62.591 c 7.51,-13.101 14.559,-26.627 22.799,-39.298 17.957,6.13 12.092,16.818 4.973,29.14 l -12.537,21.601 c -2.95,5.04 -7.109,11.64 -9.069,17.001 -1.206,3.286 -1.82,6.759 -1.814,10.259 -0.042,8.73 3.222,16.296 9.425,22.282 11.044,10.657 19.732,10.263 33.878,10.214 l 19.429,0.014 0.003,23.136 c -40.331,-0.994 -81.138,0.624 -121.578,-0.184 -31.681,-0.633 -56.146,-21.919 -60.014,-53.589 -0.873,-7.149 -0.495,-14.877 -0.486,-22.058 l 0.06,-29.515 c 0.035,-16.118 0.274,-30.664 -16.241,-39.35 -7.246,-3.81 -13.776,-3.603 -21.675,-3.849 -0.392,-10.024 -0.143,-21.345 -0.142,-31.463 20.481,0.572 33.329,-4.601 37.532,-27.113 1.21,-7.393 0.141,-15.408 0.549,-22.758 0.851,-15.32 -1.818,-34.478 1.216,-49.284 2.373,-11.172 7.861,-21.443 15.83,-29.625 21.289,-21.927 44.118,-18.131 71.998,-18.584 z"
        />
        <path
          fill={lightFill}
          d="m 504.84,348.55 80.623,-0.012 c 8.873,-0.003 32.247,-0.563 40.146,0.448 3.441,-0.024 4.268,0.039 7.643,0.678 11.86,0.572 26.959,9.63 34.833,18.325 7.212,8.11 12.13,17.998 14.246,28.642 1.586,8.099 1.214,16.261 1.196,24.493 l -0.087,27.359 c -0.017,5.734 -0.384,16.805 0.55,22.093 2.915,16.504 14.895,25.421 31.094,26.315 2.269,0.107 4.54,0.15 6.811,0.13 l 0.062,31.031 c -7.564,0.104 -14.243,0.022 -21.269,3.334 -19.109,9.007 -17.279,28.176 -17.252,45.86 l 0.04,25.951 c 0.025,23.418 -0.609,38.957 -19.189,56.472 -11.545,10.884 -26.214,14.807 -41.798,15.283 -0.807,0.024 -1.613,0.042 -2.42,0.055 6.017,-6.992 12.804,-14.359 16.767,-22.852 7.125,-15.269 6.655,-31.359 7.204,-47.581 0.585,-17.297 -1.421,-41.292 3.645,-57.62 2.792,-9.13 8.166,-17.257 15.476,-23.399 6.221,-5.208 12.69,-8.043 20.151,-11.014 -68.561,-24.918 -20.745,-99.516 -49.077,-148.392 -2.862,-4.938 -8.216,-10.137 -12.408,-14.009 l -0.405,0.012 c -1.309,1.679 -5.006,8.255 -6.254,10.371 l -12.943,21.972 -37.717,63.069 c -3.815,6.418 -12.238,22.061 -16.336,26.922 -18.643,-2.728 -14.426,-14.864 -7.598,-26.33 6.972,-11.705 18.176,-26.188 18.143,-39.865 -0.063,-9.391 -3.848,-18.373 -10.525,-24.978 -12.694,-12.482 -26.926,-10.311 -43.374,-10.097 -0.077,-7.555 -0.07,-15.111 0.022,-22.666 z"
        />
      </g>
    </svg>
  );
}

export function VSCodeIcon({
  size = 15,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const id = useId();
  const maskId = `vscode-mask-${id}`;
  const filter0Id = `vscode-f0-${id}`;
  const filter1Id = `vscode-f1-${id}`;
  const gradId = `vscode-grad-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <mask
        id={maskId}
        mask-type="alpha"
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="100"
        height="100"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M70.9119 99.3171C72.4869 99.9307 74.2828 99.8914 75.8725 99.1264L96.4608 89.2197C98.6242 88.1787 100 85.9892 100 83.5872V16.4133C100 14.0113 98.6243 11.8218 96.4609 10.7808L75.8725 0.873756C73.7862 -0.130129 71.3446 0.11576 69.5135 1.44695C69.252 1.63711 69.0028 1.84943 68.769 2.08341L29.3551 38.0415L12.1872 25.0096C10.589 23.7965 8.35363 23.8959 6.86933 25.2461L1.36303 30.2549C-0.452552 31.9064 -0.454633 34.7627 1.35853 36.417L16.2471 50.0001L1.35853 63.5832C-0.454633 65.2374 -0.452552 68.0938 1.36303 69.7453L6.86933 74.7541C8.35363 76.1043 10.589 76.2037 12.1872 74.9905L29.3551 61.9587L68.769 97.9167C69.3925 98.5406 70.1246 99.0104 70.9119 99.3171ZM75.0152 27.2989L45.1091 50.0001L75.0152 72.7012V27.2989Z"
          fill="white"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path
          d="M96.4614 10.7962L75.8569 0.875542C73.4719 -0.272773 70.6217 0.211611 68.75 2.08333L1.29858 63.5832C-0.515693 65.2373 -0.513607 68.0937 1.30308 69.7452L6.81272 74.754C8.29793 76.1042 10.5347 76.2036 12.1338 74.9905L93.3609 13.3699C96.086 11.3026 100 13.2462 100 16.6667V16.4275C100 14.0265 98.6246 11.8378 96.4614 10.7962Z"
          fill="#0065A9"
        />
        <g filter={`url(#${filter0Id})`}>
          <path
            d="M96.4614 89.2038L75.8569 99.1245C73.4719 100.273 70.6217 99.7884 68.75 97.9167L1.29858 36.4169C-0.515693 34.7627 -0.513607 31.9063 1.30308 30.2548L6.81272 25.246C8.29793 23.8958 10.5347 23.7964 12.1338 25.0095L93.3609 86.6301C96.086 88.6974 100 86.7538 100 83.3334V83.5726C100 85.9735 98.6246 88.1622 96.4614 89.2038Z"
            fill="#007ACC"
          />
        </g>
        <g filter={`url(#${filter1Id})`}>
          <path
            d="M75.8578 99.1263C73.4721 100.274 70.6219 99.7885 68.75 97.9166C71.0564 100.223 75 98.5895 75 95.3278V4.67213C75 1.41039 71.0564 -0.223106 68.75 2.08329C70.6219 0.211402 73.4721 -0.273666 75.8578 0.873633L96.4587 10.7807C98.6234 11.8217 100 14.0112 100 16.4132V83.5871C100 85.9891 98.6234 88.1786 96.4586 89.2196L75.8578 99.1263Z"
            fill="#1F9CF0"
          />
        </g>
        <g style={{ mixBlendMode: 'overlay' }} opacity="0.25">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M70.8511 99.3171C72.4261 99.9306 74.2221 99.8913 75.8117 99.1264L96.4 89.2197C98.5634 88.1787 99.9392 85.9892 99.9392 83.5871V16.4133C99.9392 14.0112 98.5635 11.8217 96.4001 10.7807L75.8117 0.873695C73.7255 -0.13019 71.2838 0.115699 69.4527 1.44688C69.1912 1.63705 68.942 1.84937 68.7082 2.08335L29.2943 38.0414L12.1264 25.0096C10.5283 23.7964 8.29285 23.8959 6.80855 25.246L1.30225 30.2548C-0.513334 31.9064 -0.515415 34.7627 1.29775 36.4169L16.1863 50L1.29775 63.5832C-0.515415 65.2374 -0.513334 68.0937 1.30225 69.7452L6.80855 74.754C8.29285 76.1042 10.5283 76.2036 12.1264 74.9905L29.2943 61.9586L68.7082 97.9167C69.3317 98.5405 70.0638 99.0104 70.8511 99.3171ZM74.9544 27.2989L45.0483 50L74.9544 72.7012V27.2989Z"
            fill={`url(#${gradId})`}
          />
        </g>
      </g>
      <defs>
        <filter
          id={filter0Id}
          x="-8.39411"
          y="15.8291"
          width="116.727"
          height="92.2456"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="4.16667" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend mode="overlay" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
        <filter
          id={filter1Id}
          x="60.4167"
          y="-8.07558"
          width="47.9167"
          height="116.151"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="4.16667" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend mode="overlay" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
        <linearGradient
          id={gradId}
          x1="49.9392"
          y1="0.257812"
          x2="49.9392"
          y2="99.7423"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Single source of truth for UI icons (Phosphor). Call sites import the names
 * below, so swapping the icon pack later means editing only this file. The
 * default weight is set once in main.tsx through IconContext.
 */
export {
  Article,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsInSimple,
  ArrowsOutSimple,
  ArrowUp,
  ArrowsClockwise as RefreshCw,
  ArrowCounterClockwise as Undo2,
  BookBookmark,
  BracketsCurly,
  Check,
  ClockCounterClockwise as History,
  Code,
  CaretDown,
  CaretDown as ChevronDown,
  CaretUp as ChevronUp,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  Columns as Columns2,
  Copy,
  Crosshair as LocateFixed,
  DotsThree as Ellipsis,
  FilePlus as FilePlus2,
  FileText,
  Image,
  Package,
  Files,
  FloppyDisk as Save,
  Folder,
  FolderOpen,
  FolderPlus,
  GearSix as Settings,
  Hammer,
  FilePdf,
  ListChecks,
  NotePencil,
  PaintBrushHousehold as Broom,
  Palette,
  Wrench,
  MagnifyingGlass as Search,
  PencilSimple as Pencil,
  Play,
  Plus,
  PushPin as Pin,
  Stop as Square,
  Trash as Trash2,
  Warning,
  WarningCircle,
  Scroll,
  Key,
  Keyboard,
  Star,
  TextIndent,
  Lock,
  LockOpen,
  X,
} from '@phosphor-icons/react';

export interface PanelIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function PanelLeft({ size = 16, className, style }: PanelIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function PanelLeftClose({ size = 16, className, style }: PanelIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </svg>
  );
}

export function PanelLeftOpen({ size = 16, className, style }: PanelIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m14 9 3 3-3 3" />
    </svg>
  );
}

export function PanelRight({ size = 16, className, style }: PanelIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

export function PanelRightClose({ size = 16, className, style }: PanelIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      <path d="m8 9 3 3-3 3" />
    </svg>
  );
}

export function PanelRightOpen({ size = 16, className, style }: PanelIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      <path d="m10 15-3-3 3-3" />
    </svg>
  );
}
