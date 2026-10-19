import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BuildState, PdfLocation, ProjectInfo, SourceLocation } from '../../../../shared/api';
import './pdf.css';

GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  project: ProjectInfo | null;
  build: BuildState;
  source: { path: string; line: number } | null;
  onNavigate: (location: SourceLocation) => void;
}

export default function PdfViewer({ project, build, source, onNavigate }: Props) {
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
  const [location, setLocation] = useState<PdfLocation | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const preservedScroll = useRef<{ top: number; left: number } | null>(null);
  const pageInfo = useRef<{ page: PDFPageProxy; scale: number } | null>(null);
  const searchId = useRef(0);
  const cancelSearch = useCallback(() => {
    searchId.current++;
  }, []);
  const activeProject = project?.id;
  const pdfPath = build.projectId === activeProject ? build.pdfPath : null;

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
    cancelSearch();
    setSearching(false);
    scroll.current?.focus();
  }

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.max(100, entry.contentRect.width - 40));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let document: PDFDocumentProxy | undefined;
    let task: ReturnType<typeof getDocument> | undefined;
    preservedScroll.current = {
      top: scroll.current?.scrollTop ?? 0,
      left: scroll.current?.scrollLeft ?? 0,
    };
    setPdf(null);
    setError(null);
    setLocation(null);
    setMatches([]);
    setSearched(false);
    searchId.current++;
    if (!activeProject || !pdfPath) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const result = await window.textra.readPdf({ projectId: activeProject, path: pdfPath });
        if (!result.ok) throw new Error(result.error);
        if (disposed) return;
        task = getDocument({
          data: new Uint8Array(result.value),
          enableXfa: false,
          maxImageSize: 16_000_000,
        });
        document = await task.promise;
        if (disposed) {
          await task.destroy();
          return;
        }
        setPdf(document);
        setPageNumber((current) => Math.min(Math.max(1, current), document!.numPages));
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
      if (task) void task.destroy().catch(() => undefined);
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
        element.width = Math.ceil(viewport.width * ratio);
        element.height = Math.ceil(viewport.height * ratio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        pageInfo.current = { page, scale };
        rendering = page.render({
          canvas: element,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await rendering.promise;
        if (disposed) return;
        scroll.current?.scrollTo(previousScroll.left, previousScroll.top);
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
      pageInfo.current = null;
    };
  }, [pdf, pageNumber, zoom, fit, width, location]);

  async function findText() {
    if (!pdf || !query.trim()) return;
    const id = ++searchId.current;
    setSearching(true);
    setSearched(false);
    setMatches([]);
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
      {pdf && (
        <div className="pdf-toolbar">
          <button
            aria-label="Previous PDF page"
            disabled={pageNumber <= 1}
            onClick={() => {
              setLocation(null);
              setPageNumber(pageNumber - 1);
            }}
          >
            ‹
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
            ›
          </button>
          <select
            aria-label="PDF zoom"
            value={fit ? 'fit' : String(zoom)}
            onChange={(event) => {
              setFit(event.target.value === 'fit');
              if (event.target.value !== 'fit') setZoom(Number(event.target.value));
            }}
          >
            <option value="fit">Fit width</option>
            {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((value) => (
              <option key={value} value={value}>
                {value * 100}%
              </option>
            ))}
          </select>
          <button
            onClick={() => void forward()}
            disabled={!source}
            title="Find editor cursor in the PDF"
          >
            Go to source line
          </button>
        </div>
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
            <button
              type="button"
              onClick={() => {
                setLocation(null);
                setPageNumber(matches.find((number) => number > pageNumber) ?? matches[0]);
              }}
            >
              Next match
            </button>
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
        {loading ? (
          <div className="pdf-empty" role="status">
            Loading PDF…
          </div>
        ) : pdf ? (
          <canvas
            ref={canvas}
            tabIndex={0}
            aria-label={`PDF page ${pageNumber}`}
            onDoubleClick={(event) => void inverse(event)}
            title="Double-click to find this position in the source"
          />
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
