import { forwardRef, type ReactElement } from 'react';
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
  Palette,
  Wrench,
  MagnifyingGlass as Search,
  PencilSimple as Pencil,
  Play,
  Plus,
  PushPin as Pin,
  SidebarSimple as PanelLeft,
  SidebarSimple as PanelLeftClose,
  SidebarSimple as PanelLeftOpen,
  Sidebar as PanelRightClose,
  Sidebar as PanelRightOpen,
  Stop as Square,
  Trash as Trash2,
  Warning,
  WarningCircle,
  Scroll,
  Key,
  Star,
  TextIndent,
  Lock,
  LockOpen,
  X,
} from '@phosphor-icons/react';
