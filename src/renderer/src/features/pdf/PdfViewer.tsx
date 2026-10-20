import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Ellipsis, LocateFixed } from '../../icons';
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
}: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
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
  const [renderedScale, setRenderedScale] = useState(0);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [location, setLocation] = useState<PdfLocation | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const preservedScroll = useRef<{ top: number; left: number } | null>(null);
  const pageInfo = useRef<{ page: PDFPageProxy; scale: number } | null>(null);
  const pdfRef = useRef<ReturnType<typeof getDocument> | null>(null);
  const lastHeight = useRef(0);
  const searchId = useRef(0);
  /** Scale requested by pinch/ctrl+wheel that the canvas has not caught up with yet. */
  const pendingScale = useRef<number | null>(null);
  const cancelSearch = useCallback(() => {
    searchId.current++;
  }, []);
  const activeProject = project?.id;
  const pdfPath = externalPdfPath ?? (build.projectId === activeProject ? build.pdfPath : null);

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
    setHighlights([]);
    cancelSearch();
    setSearching(false);
    scroll.current?.focus();
  }

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    let timer: number | undefined;
    // Re-fit only after resizing settles so the page is not re-rendered on every frame.
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

  // Touchpad pinch arrives as a wheel event with ctrlKey set (Chromium synthesizes it), as does
  // Ctrl+wheel. It must be a native non-passive listener so the browser's page zoom is cancelled.
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const info = pageInfo.current;
      if (!info) return;
      const base = pendingScale.current ?? info.scale;
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, base * Math.exp(-event.deltaY * lines * 0.01)),
      );
      if (Math.abs(next - base) < 1e-4) return;
      // Keep the point under the cursor fixed while the page grows or shrinks.
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
  }, []);

  useEffect(
    () => () => {
      const last = pdfRef.current;
      pdfRef.current = null;
      if (last) void last.destroy().catch(() => undefined);
    },
    [],
  );

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
        // Swap documents without unmounting the canvas, so recompiling does not flash.
        const previous = pdfRef.current;
        pdfRef.current = task;
        adopted = true;
        setPdf(loaded);
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
  }, [activeProject, pdfPath, build.pdfVersion, cancelSearch]);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let disposed = false;
    let rendering: RenderTask | undefined;
    const element = canvas.current;
    const previousScroll = preservedScroll.current ?? {
      top: scroll.current?.scrollTop ?? 0,
      left: scroll.current?.scrollLeft ?? 0,
    };
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (disposed) return;
        const natural = page.getViewport({ scale: 1 });
        const scale = fit ? Math.min(3, Math.max(0.1, width / natural.width)) : zoom;
        const viewport = page.getViewport({ scale });
        // Bound backing canvas memory independently of oversized PDF page dimensions.
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        // Draw off screen, then swap in one step. Resizing the visible canvas clears it, which
        // showed up as flicker whenever the page re-rendered.
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
        const context = element.getContext('2d');
        const oldHeight = lastHeight.current;
        element.width = buffer.width;
        element.height = buffer.height;
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        context?.drawImage(buffer, 0, 0);
        lastHeight.current = viewport.height;
        pageInfo.current = { page, scale };
        if (pendingScale.current !== null && Math.abs(pendingScale.current - scale) < 1e-4)
          pendingScale.current = null;
        setRenderedScale(scale);
        // Keep the reading position when the page changes size (window resize, zoom).
        const factor = preservedScroll.current || !oldHeight ? 1 : viewport.height / oldHeight;
        scroll.current?.scrollTo(previousScroll.left * factor, previousScroll.top * factor);
        preservedScroll.current = null;
        if (location?.page === pageNumber) {
          const [x, y] = viewport.convertToViewportPoint(
            location.x + page.view[0],
            page.view[3] - location.y,
          );
          scroll.current?.scrollTo({
            left: Math.max(0, x - width / 2),
            top: Math.max(0, y - 120),
            behavior: 'smooth',
          });
        }
      } catch (failure) {
        if (
          !disposed &&
          !(failure instanceof Error && failure.name === 'RenderingCancelledException')
        )
          setError(failure instanceof Error ? failure.message : 'Page could not be rendered.');
      }
    })();
    return () => {
      disposed = true;
      rendering?.cancel();
    };
  }, [pdf, pageNumber, zoom, fit, width, location]);

  // Search highlights are computed separately so searching never re-renders the page bitmap.
  useEffect(() => {
    if (!pdf || !searchTerm || !renderedScale) {
      setHighlights([]);
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        if (!disposed)
          setHighlights(
            highlightRects(content.items, page.getViewport({ scale: renderedScale }), searchTerm),
          );
      } catch {
        if (!disposed) setHighlights([]);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [pdf, pageNumber, searchTerm, renderedScale]);

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
        setLocation(null);
        setPageNumber(found[0]);
      }
    } catch {
      if (id === searchId.current) setError('PDF text search could not finish.');
    } finally {
      if (id === searchId.current) setSearching(false);
    }
  }
  async function forward() {
    if (!project || !source || !build.rootFile) return;
    setError(null);
    const result = await window.textra.syncForward({
      projectId: project.id,
      rootFile: build.rootFile,
      path: source.path,
      line: source.line,
    });
    if (result.ok) {
      setPageNumber(result.value.page);
      setLocation(result.value);
    } else setError(result.error);
  }
  async function inverse(event: React.MouseEvent<HTMLCanvasElement>) {
    const info = pageInfo.current;
    if (!project || !build.rootFile || !info) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewport = info.page.getViewport({ scale: info.scale });
    const [x, y] = viewport.convertToPdfPoint(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );
    const result = await window.textra.syncInverse({
      projectId: project.id,
      rootFile: build.rootFile,
      page: pageNumber,
      x: x - info.page.view[0],
      y: info.page.view[3] - y,
    });
    if (result.ok) {
      setError(null);
      onNavigate(result.value);
    } else setError(result.error);
  }

  const toolbarInner = pdf ? (
    <>
      <button
        aria-label="Previous PDF page"
        disabled={pageNumber <= 1}
        onClick={() => {
          setLocation(null);
          setPageNumber(pageNumber - 1);
        }}
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
            setLocation(null);
            setPageNumber(Math.min(pdf.numPages, Math.max(1, Number(event.target.value) || 1)));
          }}
        />{' '}
        / {pdf.numPages}
      </label>
      <button
        aria-label="Next PDF page"
        disabled={pageNumber >= pdf.numPages}
        onClick={() => {
          setLocation(null);
          setPageNumber(pageNumber + 1);
        }}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <select
        aria-label="PDF zoom"
        value={fit ? 'fit' : String(zoom)}
        onChange={(event) => {
          pendingScale.current = null;
          setFit(event.target.value === 'fit');
          if (event.target.value !== 'fit') setZoom(Number(event.target.value));
        }}
      >
        <option value="fit">Fit width</option>
        {!fit && !ZOOM_PRESETS.includes(zoom) && (
          <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>
        )}
        {ZOOM_PRESETS.map((value) => (
          <option key={value} value={value}>
            {value * 100}%
          </option>
        ))}
      </select>
      <button
        className="pdf-source-sync"
        aria-label="Go to source line"
        onClick={() => void forward()}
        disabled={!source}
        title="Find editor cursor in the PDF"
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
                  setLocation(null);
                  setPageNumber(
                    [...matches].reverse().find((number) => number < pageNumber) ??
                      matches[matches.length - 1],
                  );
                }}
              >
                Previous match
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocation(null);
                  setPageNumber(matches.find((number) => number > pageNumber) ?? matches[0]);
                }}
              >
                Next match
              </button>
            </>
          )}
        </form>
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
        onPointerDown={(event) => {
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
          <div className="pdf-page">
            <canvas
              ref={canvas}
              tabIndex={0}
              aria-label={`PDF page ${pageNumber}`}
              onDoubleClick={(event) => void inverse(event)}
              title="Double-click to find this position in the source"
            />
            <div className="pdf-highlights" aria-hidden="true">
              {highlights.map((box, index) => (
                <span key={index} className="pdf-highlight" style={box} />
              ))}
            </div>
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
