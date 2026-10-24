import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight, Ellipsis, LocateFixed } from '../../icons';
import { DropdownMenu } from '../../components/DropdownMenu';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BuildState, PdfLocation, ProjectInfo, SourceLocation } from '../../../../shared/api';
import './pdf.css';
import { markStartup } from '../startup/scheduling';

GlobalWorkerOptions.workerSrc = workerUrl;

interface Highlight {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MAX_HIGHLIGHTS = 500;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** The fields of a PDF.js text content item that highlighting needs. */
interface TextItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

/**
 * Approximates match boxes from PDF.js text items. Offsets inside an item are proportional to
 * character count, so boxes are close but not glyph-exact; matches split across items are
 * found by page search but not boxed.
 */
function highlightRects(
  items: ReadonlyArray<unknown>,
  viewport: PageViewport,
  term: string,
): Highlight[] {
  const needle = term.toLocaleLowerCase();
  const found: Highlight[] = [];
  if (!needle) return found;
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item) || !('transform' in item)) continue;
    const text = item as TextItem;
    if (!text.str || !(text.width > 0)) continue;
    const haystack = text.str.toLocaleLowerCase();
    if (haystack.length !== text.str.length) continue;
    const base = text.transform[5] as number;
    const left = text.transform[4] as number;
    const height = text.height || Math.abs(text.transform[3] as number);
    let from = haystack.indexOf(needle);
    while (from !== -1 && found.length < MAX_HIGHLIGHTS) {
      const [x1, y1] = viewport.convertToViewportPoint(
        left + (text.width * from) / text.str.length,
        base - height * 0.2,
      ) as [number, number];
      const [x2, y2] = viewport.convertToViewportPoint(
        left + (text.width * (from + needle.length)) / text.str.length,
        base + height * 0.85,
      ) as [number, number];
      found.push({
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      });
      from = haystack.indexOf(needle, from + needle.length);
    }
  }
  return found;
}

interface PageItemProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  defaultDimensions: { width: number; height: number };
  searchTerm: string;
  synctexLocation: PdfLocation | null;
  onInverse: (
    event: React.MouseEvent<HTMLCanvasElement>,
    pageNumber: number,
    page: PDFPageProxy,
    scale: number,
  ) => void;
  registerPageRef: (pageNumber: number, el: HTMLDivElement | null) => void;
}

function PdfPageItem({
  pdf,
  pageNumber,
  scale,
  defaultDimensions,
  searchTerm,
  synctexLocation,
  onInverse,
  registerPageRef,
}: PageItemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [rendered, setRendered] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [synctexPoint, setSynctexPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    registerPageRef(pageNumber, containerRef.current);
    return () => {
      registerPageRef(pageNumber, null);
    };
  }, [pageNumber, registerPageRef]);

  // Render canvas buffer when mounted in the virtualized window
  useEffect(() => {
    if (!pdf) return;
    let disposed = false;
    let rendering: RenderTask | undefined;

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (disposed) return;
        setPageProxy(page);
        const natural = page.getViewport({ scale: 1 });
        setPageDimensions({ width: natural.width, height: natural.height });

        const viewport = page.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );

        const buffer = window.document.createElement('canvas');
        buffer.width = Math.ceil(viewport.width * ratio);
        buffer.height = Math.ceil(viewport.height * ratio);

        rendering = page.render({
          canvas: buffer,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await rendering.promise;
        if (disposed) return;

        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = buffer.width;
          canvas.height = buffer.height;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(buffer, 0, 0);
          markStartup('pdf-ready');
          setRendered(true);
        }
      } catch (err) {
        if (!disposed && !(err instanceof Error && err.name === 'RenderingCancelledException')) {
          console.error(`Page ${pageNumber} render error:`, err);
        }
      }
    })();

    return () => {
      disposed = true;
      rendering?.cancel();
    };
  }, [pdf, pageNumber, scale]);

  // Search highlights
  useEffect(() => {
    if (!pageProxy || !searchTerm) {
      setHighlights([]);
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const content = await pageProxy.getTextContent();
        if (disposed) return;
        const viewport = pageProxy.getViewport({ scale });
        setHighlights(highlightRects(content.items, viewport, searchTerm));
      } catch {
        if (!disposed) setHighlights([]);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [pageProxy, searchTerm, scale]);

  // SyncTeX indicator
  useEffect(() => {
    if (!synctexLocation || synctexLocation.page !== pageNumber || !pageProxy) {
      setSynctexPoint(null);
      return;
    }
    const viewport = pageProxy.getViewport({ scale });
    const [x, y] = viewport.convertToViewportPoint(
      synctexLocation.x + pageProxy.view[0],
      pageProxy.view[3] - synctexLocation.y,
    );
    setSynctexPoint({ x, y });
    const timer = window.setTimeout(() => setSynctexPoint(null), 2600);
    return () => window.clearTimeout(timer);
  }, [synctexLocation, pageNumber, pageProxy, scale]);

  const natural = pageDimensions ?? defaultDimensions;
  const pageWidth = Math.round(natural.width * scale);
  const pageHeight = Math.round(natural.height * scale);

  return (
    <div
      className="pdf-page"
      ref={containerRef}
      data-page-number={pageNumber}
      style={{
        width: `${pageWidth}px`,
        height: `${pageHeight}px`,
        margin: '0 auto',
      }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={`PDF page ${pageNumber}`}
        onDoubleClick={(event) => {
          if (pageProxy) onInverse(event, pageNumber, pageProxy, scale);
        }}
        title="Double-click to find this position in the source"
        style={{
          display: rendered ? 'block' : 'none',
        }}
      />
      {highlights.length > 0 && (
        <div className="pdf-highlights" aria-hidden="true">
          {highlights.map((box, index) => (
            <span key={index} className="pdf-highlight" style={box} />
          ))}
        </div>
      )}
      {synctexPoint && (
        <div
          className="pdf-synctex-indicator"
          aria-hidden="true"
          style={{
            left: `${synctexPoint.x}px`,
            top: `${synctexPoint.y}px`,
          }}
        />
      )}
    </div>
  );
}

interface Props {
  project: ProjectInfo | null;
  build: BuildState;
  source: { path: string; line: number } | null;
  onNavigate: (location: SourceLocation) => void;
  /** Element in the preview header that receives the page and zoom controls. */
  toolbarSlot: HTMLElement | null;
  /** Show the controls inside a "..." menu because the header is narrow. */
  compact: boolean;
  /** False while another preview tab is showing, which hides the controls. */
  active: boolean;
  /** When set, the controls live inside the preview "..." menu instead of the header. */
  menuSlot?: HTMLElement | null;
  menuMode?: boolean;
  /** A project PDF explicitly chosen from Files, rather than the latest build output. */
  externalPdfPath?: string | null;
  /** A validated previous-session output has no current SyncTeX mapping. */
  restored?: boolean;
}

export default function PdfViewer({
  project,
  build,
  source,
  onNavigate,
  toolbarSlot,
  compact,
  active,
  menuSlot = null,
  menuMode = false,
  externalPdfPath = null,
  restored = false,
}: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [defaultDimensions, setDefaultDimensions] = useState({ width: 595, height: 842 });
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [width, setWidth] = useState(500);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<number[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [location, setLocation] = useState<PdfLocation | null>(null);

  const scroll = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const searchInput = useRef<HTMLInputElement>(null);
  const preservedScroll = useRef<{ top: number; left: number } | null>(null);
  const pdfRef = useRef<ReturnType<typeof getDocument> | null>(null);
  const searchId = useRef(0);
  const pendingScale = useRef<number | null>(null);
  const isProgrammaticScroll = useRef(false);
  const scrollTimer = useRef<number | undefined>(undefined);
  const scrollRaf = useRef<number | null>(null);

  const activeProject = project?.id;
  const pdfPath = externalPdfPath ?? (build.projectId === activeProject ? build.pdfPath : null);

  const scale = fit ? Math.min(3, Math.max(0.1, width / defaultDimensions.width)) : zoom;
  const prevScaleRef = useRef(scale);

  const pages = useMemo(() => {
    if (!pdf) return [];
    return Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  }, [pdf]);

  const rowVirtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => Math.round(defaultDimensions.height * scale) + 24,
    overscan: 2,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [scale, defaultDimensions.height, rowVirtualizer]);

  const cancelSearch = useCallback(() => {
    searchId.current++;
  }, []);

  const registerPageRef = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    pageRefs.current[pageNum] = el;
  }, []);

  useEffect(() => {
    if (searchOpen && pdf) {
      searchInput.current?.focus();
      searchInput.current?.select();
    }
  }, [searchOpen, pdf]);

  useEffect(() => {
    const findPdf = () => {
      if (!pdf) return;
      setSearchOpen(true);
      searchInput.current?.focus();
      searchInput.current?.select();
    };
    window.addEventListener('textra:find-pdf', findPdf);
    return () => window.removeEventListener('textra:find-pdf', findPdf);
  }, [pdf]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchTerm('');
    cancelSearch();
    setSearching(false);
    scroll.current?.focus();
  }

  // Observe container width changes for fit-width
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next <= 0) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWidth(Math.max(100, next - 40)), 120);
    });
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Scale preservation when container width or zoom changes
  useEffect(() => {
    if (
      prevScaleRef.current &&
      prevScaleRef.current !== scale &&
      scroll.current &&
      !preservedScroll.current
    ) {
      const ratio = scale / prevScaleRef.current;
      scroll.current.scrollTop = scroll.current.scrollTop * ratio;
      scroll.current.scrollLeft = scroll.current.scrollLeft * ratio;
    }
    prevScaleRef.current = scale;
  }, [scale]);

  // Touchpad pinch / Ctrl+wheel zoom
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const base = pendingScale.current ?? scale;
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, base * Math.exp(-event.deltaY * lines * 0.01)),
      );
      if (Math.abs(next - base) < 1e-4) return;
      const bounds = element.getBoundingClientRect();
      const pointX = event.clientX - bounds.left;
      const pointY = event.clientY - bounds.top;
      const origin = preservedScroll.current ?? {
        top: element.scrollTop,
        left: element.scrollLeft,
      };
      const ratio = next / base;
      preservedScroll.current = {
        left: Math.max(0, (origin.left + pointX) * ratio - pointX),
        top: Math.max(0, (origin.top + pointY) * ratio - pointY),
      };
      pendingScale.current = next;
      setFit(false);
      setZoom(next);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [scale]);

  // Apply preserved scroll after pinch zoom
  useEffect(() => {
    if (preservedScroll.current && scroll.current) {
      scroll.current.scrollTo(preservedScroll.current.left, preservedScroll.current.top);
      preservedScroll.current = null;
      pendingScale.current = null;
    }
  }, [scale]);

  useEffect(
    () => () => {
      const last = pdfRef.current;
      pdfRef.current = null;
      if (last) void last.destroy().catch(() => undefined);
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
      window.clearTimeout(scrollTimer.current);
    },
    [],
  );

  // Load PDF
  useEffect(() => {
    let disposed = false;
    let adopted = false;
    let task: ReturnType<typeof getDocument> | undefined;
    preservedScroll.current = {
      top: scroll.current?.scrollTop ?? 0,
      left: scroll.current?.scrollLeft ?? 0,
    };
    setError(null);
    setLocation(null);
    setMatches([]);
    setSearched(false);
    searchId.current++;
    if (!activeProject || !pdfPath) {
      const last = pdfRef.current;
      pdfRef.current = null;
      setPdf(null);
      setLoading(false);
      if (last) void last.destroy().catch(() => undefined);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const result = externalPdfPath
          ? await window.textra.readProjectPdf({ projectId: activeProject, path: pdfPath })
          : await window.textra.readPdf({ projectId: activeProject, path: pdfPath });
        if (!result.ok) throw new Error(result.error);
        if (disposed) return;
        task = getDocument({
          data: new Uint8Array(result.value),
          enableXfa: false,
          maxImageSize: 16_000_000,
        });
        const loaded = await task.promise;
        if (disposed) {
          await task.destroy();
          return;
        }

        const previous = pdfRef.current;
        pdfRef.current = task;
        adopted = true;
        setPdf(loaded);

        // Fetch page 1 natural dimensions for layout placeholders
        try {
          const firstPage = await loaded.getPage(1);
          const firstViewport = firstPage.getViewport({ scale: 1 });
          setDefaultDimensions({ width: firstViewport.width, height: firstViewport.height });
        } catch {
          // Standard A4 dimensions
          setDefaultDimensions({ width: 595, height: 842 });
        }

        setPageNumber((current) => Math.min(Math.max(1, current), loaded.numPages));
        if (previous) window.setTimeout(() => void previous.destroy().catch(() => undefined), 1000);
      } catch (failure) {
        if (!disposed)
          setError(failure instanceof Error ? failure.message : 'PDF could not be loaded.');
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      cancelSearch();
      if (task && !adopted) void task.destroy().catch(() => undefined);
    };
  }, [activeProject, pdfPath, build.pdfVersion, cancelSearch, externalPdfPath]);

  // Programmatic scroll to page
  const scrollToPage = useCallback(
    (targetPage: number, behavior: ScrollBehavior = 'smooth') => {
      if (!pdf) return;
      const target = Math.min(pdf.numPages, Math.max(1, targetPage));
      setPageNumber(target);
      setLocation(null);
      isProgrammaticScroll.current = true;
      rowVirtualizer.scrollToIndex(target - 1, { align: 'start', behavior });
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = window.setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 700);
    },
    [pdf, rowVirtualizer],
  );

  // SyncTeX location scrolling
  const scrollToLocation = useCallback(
    async (loc: PdfLocation) => {
      const container = scroll.current;
      if (!container || !pdf) return;

      isProgrammaticScroll.current = true;
      try {
        const page = await pdf.getPage(loc.page);
        const natural = page.getViewport({ scale: 1 });
        const currentScale = fit ? Math.min(3, Math.max(0.1, width / natural.width)) : zoom;
        const viewport = page.getViewport({ scale: currentScale });
        const [vx, vy] = viewport.convertToViewportPoint(
          loc.x + page.view[0],
          page.view[3] - loc.y,
        );

        rowVirtualizer.scrollToIndex(loc.page - 1, { align: 'start' });
        const virtualItem = rowVirtualizer
          .getVirtualItems()
          .find((item) => item.index === loc.page - 1);
        const startY = virtualItem
          ? virtualItem.start
          : (loc.page - 1) * (Math.round(natural.height * currentScale) + 24);
        const targetY = startY + vy - 120;
        const targetX = Math.max(0, vx - width / 2);
        container.scrollTo({
          top: Math.max(0, targetY),
          left: targetX,
          behavior: 'smooth',
        });
      } catch {
        rowVirtualizer.scrollToIndex(loc.page - 1, { align: 'start', behavior: 'smooth' });
      }

      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = window.setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 700);
    },
    [pdf, fit, width, zoom, rowVirtualizer],
  );

  // Dynamic scroll listener: tracks active page in view for the toolbar in O(1)
  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current) return;
    if (scrollRaf.current !== null) return;

    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      const container = scroll.current;
      if (!container || !pdf) return;

      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 20) {
        setPageNumber(pdf.numPages);
        return;
      }

      const virtualItems = rowVirtualizer.getVirtualItems();
      if (!virtualItems.length) return;

      const focalY = container.scrollTop + Math.min(150, container.clientHeight / 3);
      const activeItem =
        virtualItems.find((item) => item.start <= focalY && item.end >= focalY) ?? virtualItems[0];
      if (activeItem) {
        const next = activeItem.index + 1;
        setPageNumber((current) => (current !== next ? next : current));
      }
    });
  }, [pdf, rowVirtualizer]);

  async function findText() {
    if (!pdf || !query.trim()) return;
    const id = ++searchId.current;
    setSearching(true);
    setSearched(false);
    setMatches([]);
    setSearchTerm('');
    const found: number[] = [];
    try {
      for (let number = 1; number <= Math.min(pdf.numPages, 2000); number++) {
        const page = await pdf.getPage(number);
        if (id !== searchId.current) return;
        const content = await page.getTextContent();
        if (id !== searchId.current) return;
        const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        if (text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) found.push(number);
      }
      setMatches(found);
      setSearched(true);
      setSearchTerm(query.trim());
      if (found[0]) {
        scrollToPage(found[0]);
      }
    } catch {
      if (id === searchId.current) setError('PDF text search could not finish.');
    } finally {
      if (id === searchId.current) setSearching(false);
    }
  }

  async function forward() {
    if (restored || !project || !source || !build.rootFile) return;
    setError(null);
    const result = await window.textra.syncForward({
      projectId: project.id,
      rootFile: build.rootFile,
      path: source.path,
      line: source.line,
    });
    if (result.ok) {
      const loc = result.value;
      setPageNumber(loc.page);
      setLocation(loc);
      void scrollToLocation(loc);
    } else setError(result.error);
  }

  const handleInverse = useCallback(
    async (
      event: React.MouseEvent<HTMLCanvasElement>,
      pageIndex: number,
      page: PDFPageProxy,
      pageScale: number,
    ) => {
      if (restored || !project || !build.rootFile) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const viewport = page.getViewport({ scale: pageScale });
      const [x, y] = viewport.convertToPdfPoint(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
      const result = await window.textra.syncInverse({
        projectId: project.id,
        rootFile: build.rootFile,
        page: pageIndex,
        x: x - page.view[0],
        y: page.view[3] - y,
      });
      if (result.ok) {
        setError(null);
        onNavigate(result.value);
      } else setError(result.error);
    },
    [project, build.rootFile, onNavigate, restored],
  );

  const toolbarInner = pdf ? (
    <>
      <button
        aria-label="Previous PDF page"
        disabled={pageNumber <= 1}
        onClick={() => scrollToPage(pageNumber - 1)}
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <label className="pdf-page-control">
        <span className="sr-only">PDF page</span>
        <input
          aria-label="PDF page"
          type="number"
          min={1}
          max={pdf.numPages}
          value={pageNumber}
          onChange={(event) => {
            const val = Number(event.target.value);
            if (!isNaN(val) && val >= 1 && val <= pdf.numPages) {
              scrollToPage(val, 'auto');
            } else {
              setPageNumber(val);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const val = Math.min(pdf.numPages, Math.max(1, pageNumber || 1));
              scrollToPage(val, 'smooth');
            }
          }}
        />{' '}
        / {pdf.numPages}
      </label>
      <button
        aria-label="Next PDF page"
        disabled={pageNumber >= pdf.numPages}
        onClick={() => scrollToPage(pageNumber + 1)}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <DropdownMenu
        ariaLabel="PDF zoom"
        className="pdf-zoom-dropdown"
        fullWidth={false}
        value={fit ? 'fit' : String(zoom)}
        onChange={(val) => {
          pendingScale.current = null;
          setFit(val === 'fit');
          if (val !== 'fit') setZoom(Number(val));
        }}
        items={[
          { value: 'fit', label: 'Fit width' },
          ...(!fit && !ZOOM_PRESETS.includes(zoom)
            ? [{ value: String(zoom), label: `${Math.round(zoom * 100)}%` }]
            : []),
          ...ZOOM_PRESETS.map((value) => ({
            value: String(value),
            label: `${value * 100}%`,
          })),
        ]}
      />
      <button
        className="pdf-source-sync"
        aria-label="Go to source line"
        onClick={() => void forward()}
        disabled={!source || restored}
        title={
          restored
            ? 'Compile to enable source navigation for this restored PDF'
            : 'Find editor cursor in the PDF'
        }
      >
        <LocateFixed size={15} aria-hidden="true" />
      </button>
    </>
  ) : null;

  const controls = pdf ? (
    compact ? (
      <div className="pdf-controls pdf-controls-compact">
        <button
          aria-label="PDF controls"
          aria-expanded={overflowOpen}
          title="PDF controls"
          onClick={() => setOverflowOpen((open) => !open)}
        >
          <Ellipsis size={15} aria-hidden="true" />
        </button>
        {overflowOpen && (
          <div
            className="pdf-controls-menu"
            role="group"
            aria-label="PDF controls"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOverflowOpen(false);
            }}
          >
            {toolbarInner}
          </div>
        )}
      </div>
    ) : (
      <div className="pdf-controls">{toolbarInner}</div>
    )
  ) : null;

  return (
    <section
      className="pdf-viewer"
      aria-label="PDF preview"
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey) {
          if (event.key.toLowerCase() === 'f') {
            event.preventDefault();
            event.stopPropagation();
            if (pdf) {
              setSearchOpen(true);
              searchInput.current?.focus();
              searchInput.current?.select();
            }
          } else if (event.key.toLowerCase() === 'h') {
            event.preventDefault();
            event.stopPropagation();
            window.dispatchEvent(new Event('textra:replace-source'));
          }
        } else if (event.key === 'Escape' && searchOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }
      }}
    >
      {pdf && active && !menuMode && toolbarSlot && createPortal(controls, toolbarSlot)}
      {pdf &&
        active &&
        menuMode &&
        menuSlot &&
        createPortal(
          <div className="pdf-controls pdf-controls-inline">{toolbarInner}</div>,
          menuSlot,
        )}
      {pdf && searchOpen && (
        <form
          className="pdf-search"
          onSubmit={(event) => {
            event.preventDefault();
            searchInput.current?.focus();
            void findText();
          }}
        >
          <input
            ref={searchInput}
            aria-label="Search PDF"
            placeholder="Find in PDF…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={searching || !query.trim()}>
            Find
          </button>
          <button type="button" aria-label="Close PDF search" onClick={closeSearch}>
            ×
          </button>
          {searching && (
            <button
              type="button"
              onClick={() => {
                searchId.current++;
                setSearching(false);
              }}
            >
              Cancel search
            </button>
          )}
          {searched && (
            <span role="status">
              {matches.length ? `Pages: ${matches.join(', ')}` : 'No matches'}
              {pdf.numPages > 2000 ? ' (first 2,000 pages)' : ''}
            </span>
          )}
          {matches.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => {
                  const prev =
                    [...matches].reverse().find((number) => number < pageNumber) ??
                    matches[matches.length - 1];
                  scrollToPage(prev);
                }}
              >
                Previous match
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = matches.find((number) => number > pageNumber) ?? matches[0];
                  scrollToPage(next);
                }}
              >
                Next match
              </button>
            </>
          )}
        </form>
      )}
      {restored && (
        <div className="pdf-restored-status" role="status">
          Last compiled · Compile to update
        </div>
      )}
      {error && (
        <div className="pdf-error" role="alert">
          {error}
        </div>
      )}
      <div
        className="pdf-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="PDF pages"
        aria-keyshortcuts="Control+f Meta+f Control+h Meta+h"
        onScroll={handleScroll}
        onWheel={() => {
          isProgrammaticScroll.current = false;
        }}
        onPointerDown={(event) => {
          isProgrammaticScroll.current = false;
          if (
            event.target instanceof HTMLElement &&
            !event.target.closest('button, input, select, a, canvas')
          )
            event.currentTarget.focus();
        }}
      >
        {loading && !pdf ? (
          <div className="pdf-empty" role="status">
            Loading PDF…
          </div>
        ) : pdf ? (
          <div
            className="pdf-virtual-list"
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const p = pages[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    paddingBottom: '24px',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <PdfPageItem
                    pdf={pdf}
                    pageNumber={p}
                    scale={scale}
                    defaultDimensions={defaultDimensions}
                    searchTerm={searchTerm}
                    synctexLocation={location}
                    onInverse={handleInverse}
                    registerPageRef={registerPageRef}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pdf-empty">
            <h2>PDF preview</h2>
            <p>Compile to see your document.</p>
          </div>
        )}
      </div>
    </section>
  );
}
