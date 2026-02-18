import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Code, Plus, Monitor, Smartphone, Link2, Image as ImageIcon, Type, X } from "lucide-react";
import { registerEditorPlugin, type EditorPluginProps } from "@/lib/editor-plugins";

interface HTMLPreviewFrameProps extends EditorPluginProps {
  title?: string;
  onCreateCampaign?: () => void;
}

type DeviceMode = "desktop" | "mobile";

type SelectedElementState = {
  id: string;
  tag: string;
  text: string;
  href: string;
  src: string;
  backgroundImage: string;
  fontSize: string;
  fontFamily: string;
  canEditText: boolean;
  canEditLink: boolean;
  canEditImage: boolean;
  canEditBackground: boolean;
};

const EDIT_ATTR = "data-flow-edit-id";

function createEditId(): string {
  return `flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractUrl(value: string): string {
  if (!value || value === "none") return "";
  const match = value.match(/url\(["']?(.*?)["']?\)/i);
  return match?.[1] || "";
}

function toPixelValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^\d+$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

function getEditableTarget(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  const candidate = element.closest<HTMLElement>(
    "img,a,button,h1,h2,h3,h4,h5,h6,p,span,td,th,li,div"
  );

  if (!candidate) return null;
  if (candidate.tagName === "BODY" || candidate.tagName === "HTML") return null;

  if (candidate.tagName.toLowerCase() === "div") {
    const hasText = (candidate.textContent || "").trim().length > 0;
    const bg = candidate.style.backgroundImage;
    if (!hasText && (!bg || bg === "none")) {
      return null;
    }
  }

  return candidate;
}

export function HTMLPreviewFrame({
  html,
  isLoading,
  onHtmlChange,
  onCreateCampaign,
  fullWidth = false,
}: HTMLPreviewFrameProps) {
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [selectedElement, setSelectedElement] = useState<SelectedElementState | null>(null);
  const selectedRef = useRef<SelectedElementState | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const previewWidth = fullWidth ? "100%" : deviceMode === "mobile" ? 375 : 680;

  useEffect(() => {
    selectedRef.current = selectedElement;
  }, [selectedElement]);

  const getFullHtml = useCallback((): string => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return html;
    return `<!DOCTYPE html>${iframe.contentDocument.documentElement.outerHTML}`;
  }, [html]);

  const emitHtmlChange = useCallback(() => {
    if (!onHtmlChange) return;
    onHtmlChange(getFullHtml());
  }, [onHtmlChange, getFullHtml]);

  const syncHeight = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;
    const bodyHeight = doc.body?.scrollHeight || 0;
    const htmlHeight = doc.documentElement?.scrollHeight || 0;
    const nextHeight = Math.max(bodyHeight, htmlHeight, 640);
    iframe.style.height = `${nextHeight}px`;
  }, []);

  const describeElement = useCallback((element: HTMLElement): SelectedElementState => {
    const id = element.getAttribute(EDIT_ATTR) || createEditId();
    element.setAttribute(EDIT_ATTR, id);

    const tag = element.tagName.toLowerCase();
    const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
    const linkElement = tag === "a" ? element : element.closest("a");
    const inlineBg = element.style.backgroundImage;
    const backgroundImage = extractUrl(
      inlineBg && inlineBg !== "none" ? inlineBg : computed?.backgroundImage || ""
    );

    return {
      id,
      tag,
      text: tag === "img" ? "" : (element.textContent || ""),
      href: linkElement?.getAttribute("href") || "",
      src: tag === "img" ? ((element as HTMLImageElement).getAttribute("src") || "") : "",
      backgroundImage,
      fontSize: element.style.fontSize || computed?.fontSize || "",
      fontFamily: element.style.fontFamily || computed?.fontFamily || "",
      canEditText: tag !== "img",
      canEditLink: Boolean(linkElement),
      canEditImage: tag === "img",
      canEditBackground: Boolean(backgroundImage) || ["td", "div", "section"].includes(tag),
    };
  }, []);

  const applySelectedElementUpdate = useCallback(
    (patch: Partial<SelectedElementState>) => {
      if (!selectedRef.current) return;
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!doc) return;

      const element = doc.querySelector<HTMLElement>(`[${EDIT_ATTR}="${selectedRef.current.id}"]`);
      if (!element) {
        setSelectedElement(null);
        return;
      }

      if (patch.text !== undefined && selectedRef.current.canEditText) {
        element.textContent = patch.text;
      }

      if (patch.href !== undefined && selectedRef.current.canEditLink) {
        const linkElement = (element.tagName.toLowerCase() === "a" ? element : element.closest("a")) as
          | HTMLAnchorElement
          | null;
        if (linkElement) {
          const nextHref = patch.href.trim();
          if (nextHref) {
            linkElement.setAttribute("href", nextHref);
          } else {
            linkElement.removeAttribute("href");
          }
        }
      }

      if (patch.src !== undefined && selectedRef.current.canEditImage) {
        const image = element as HTMLImageElement;
        const nextSrc = patch.src.trim();
        if (nextSrc) {
          image.setAttribute("src", nextSrc);
        }
      }

      if (patch.backgroundImage !== undefined && selectedRef.current.canEditBackground) {
        const nextBg = patch.backgroundImage.trim();
        element.style.backgroundImage = nextBg ? `url("${nextBg}")` : "none";
      }

      if (patch.fontSize !== undefined) {
        const nextSize = toPixelValue(patch.fontSize);
        if (nextSize) {
          element.style.fontSize = nextSize;
        } else {
          element.style.removeProperty("font-size");
        }
      }

      if (patch.fontFamily !== undefined) {
        const nextFamily = patch.fontFamily.trim();
        if (nextFamily) {
          element.style.fontFamily = nextFamily;
        } else {
          element.style.removeProperty("font-family");
        }
      }

      const nextState = describeElement(element);
      selectedRef.current = nextState;
      setSelectedElement(nextState);
      syncHeight();
      emitHtmlChange();
    },
    [describeElement, emitHtmlChange, syncHeight]
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;

    let observer: MutationObserver | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let mountedDoc: Document | null = null;

    const scheduleSave = () => {
      if (!onHtmlChange) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        emitHtmlChange();
      }, 120);
    };

    const markEditableElements = (doc: Document) => {
      doc
        .querySelectorAll<HTMLElement>("img,a,button,h1,h2,h3,h4,h5,h6,p,span,td,th,li,div")
        .forEach((node) => {
          const tag = node.tagName.toLowerCase();
          const hasText = (node.textContent || "").trim().length > 0;
          const hasBg = Boolean(node.style.backgroundImage && node.style.backgroundImage !== "none");
          const shouldMark = tag === "img" || hasText || hasBg || Boolean(node.closest("a"));
          if (shouldMark) {
            node.setAttribute("data-flow-editable", "true");
          }
        });
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const target = event.target as HTMLElement | null;
      const editable = getEditableTarget(target);
      if (!editable) return;

      const snapshot = describeElement(editable);
      selectedRef.current = snapshot;
      setSelectedElement(snapshot);

      if (snapshot.canEditText) {
        editable.setAttribute("contenteditable", "true");
        editable.setAttribute("spellcheck", "true");
        editable.focus();
      }

      event.preventDefault();
      scheduleSave();
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const current = selectedRef.current;
      if (current) {
        const active = target.closest<HTMLElement>(`[${EDIT_ATTR}="${current.id}"]`);
        if (active) {
          const snapshot = describeElement(active);
          selectedRef.current = snapshot;
          setSelectedElement(snapshot);
        }
      }
      syncHeight();
      scheduleSave();
    };

    const handleBlur = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.getAttribute("contenteditable") === "true") {
        target.removeAttribute("contenteditable");
      }
      scheduleSave();
      syncHeight();
    };

    const handleLoad = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      mountedDoc = doc;

      doc.body.style.margin = doc.body.style.margin || "0";
      doc.body.style.background = "#ffffff";

      const style = doc.createElement("style");
      style.textContent = `
        [data-flow-editable="true"]:hover {
          outline: 1px dashed hsl(143 59% 33% / 0.55);
          outline-offset: 1px;
          cursor: text;
        }
        [${EDIT_ATTR}] {
          scroll-margin-top: 80px;
        }
      `;
      doc.head.appendChild(style);

      markEditableElements(doc);

      doc.addEventListener("dblclick", handleDoubleClick);
      doc.addEventListener("input", handleInput, true);
      doc.addEventListener("blur", handleBlur, true);

      observer = new MutationObserver(() => {
        markEditableElements(doc);
        syncHeight();
      });
      observer.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      syncHeight();
      setTimeout(syncHeight, 50);
      setTimeout(syncHeight, 200);
    };

    iframe.addEventListener("load", handleLoad);
    window.addEventListener("resize", syncHeight);

    return () => {
      iframe.removeEventListener("load", handleLoad);
      window.removeEventListener("resize", syncHeight);
      if (mountedDoc) {
        mountedDoc.removeEventListener("dblclick", handleDoubleClick);
        mountedDoc.removeEventListener("input", handleInput, true);
        mountedDoc.removeEventListener("blur", handleBlur, true);
      }
      if (observer) observer.disconnect();
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [html, describeElement, emitHtmlChange, onHtmlChange, syncHeight]);

  return (
    <div className="flex flex-col h-full relative">
      <div className={`flex-1 flex items-start justify-center overflow-auto bg-muted/20 ${fullWidth ? "p-3" : "p-4"}`}>
        {isLoading ? (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden" style={{ width: previewWidth }}>
            <Skeleton className="h-48 w-full" />
            <div className="p-4 space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ) : html ? (
          <div
            className={`relative bg-white overflow-hidden transition-all duration-300 ${
              deviceMode === "mobile" && !fullWidth
                ? "rounded-3xl border-4 border-gray-700 shadow-lg"
                : fullWidth
                  ? ""
                  : "rounded-lg shadow-lg"
            }`}
            style={{ width: previewWidth, maxWidth: fullWidth ? undefined : previewWidth }}
          >
            <iframe
              ref={iframeRef}
              srcDoc={html}
              title="Newsletter Preview"
              className="w-full border-0 bg-white"
              style={{ height: deviceMode === "mobile" ? "667px" : "680px" }}
              sandbox="allow-same-origin allow-scripts"
              data-testid="iframe-preview"
            />

            <div className="absolute left-3 top-3 z-20 flex items-center gap-1 bg-background/95 backdrop-blur-sm rounded-full p-1 shadow border">
              <Button
                size="icon"
                variant={deviceMode === "desktop" ? "secondary" : "ghost"}
                onClick={() => setDeviceMode("desktop")}
                className="rounded-full"
                data-testid="button-device-desktop"
              >
                <Monitor className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant={deviceMode === "mobile" ? "secondary" : "ghost"}
                onClick={() => setDeviceMode("mobile")}
                className="rounded-full"
                data-testid="button-device-mobile"
              >
                <Smartphone className="w-4 h-4" />
              </Button>
            </div>

            {selectedElement && (
              <div className="absolute right-3 top-3 z-20 w-80 rounded-lg border bg-background/95 backdrop-blur-sm shadow-lg" data-testid="panel-element-inspector">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Edit {selectedElement.tag}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setSelectedElement(null)}
                    data-testid="button-close-inspector"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="space-y-3 p-3 max-h-[60vh] overflow-y-auto">
                  {selectedElement.canEditText && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        <Type className="inline w-3 h-3 mr-1" />
                        Text
                      </label>
                      <Textarea
                        value={selectedElement.text}
                        onChange={(event) => applySelectedElementUpdate({ text: event.target.value })}
                        className="min-h-[90px] text-xs"
                        data-testid="input-inspector-text"
                      />
                    </div>
                  )}

                  {selectedElement.canEditLink && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        <Link2 className="inline w-3 h-3 mr-1" />
                        Link URL
                      </label>
                      <Input
                        value={selectedElement.href}
                        onChange={(event) => applySelectedElementUpdate({ href: event.target.value })}
                        className="h-8 text-xs"
                        placeholder="https://..."
                        data-testid="input-inspector-link"
                      />
                    </div>
                  )}

                  {selectedElement.canEditImage && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        <ImageIcon className="inline w-3 h-3 mr-1" />
                        Image URL
                      </label>
                      <Input
                        value={selectedElement.src}
                        onChange={(event) => applySelectedElementUpdate({ src: event.target.value })}
                        className="h-8 text-xs"
                        placeholder="https://..."
                        data-testid="input-inspector-image"
                      />
                    </div>
                  )}

                  {selectedElement.canEditBackground && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        <ImageIcon className="inline w-3 h-3 mr-1" />
                        Background image URL
                      </label>
                      <Input
                        value={selectedElement.backgroundImage}
                        onChange={(event) => applySelectedElementUpdate({ backgroundImage: event.target.value })}
                        className="h-8 text-xs"
                        placeholder="https://..."
                        data-testid="input-inspector-background"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Font size</label>
                      <Input
                        value={selectedElement.fontSize}
                        onChange={(event) => applySelectedElementUpdate({ fontSize: event.target.value })}
                        className="h-8 text-xs"
                        placeholder="16px"
                        data-testid="input-inspector-font-size"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Font family</label>
                      <Input
                        value={selectedElement.fontFamily}
                        onChange={(event) => applySelectedElementUpdate({ fontFamily: event.target.value })}
                        className="h-8 text-xs"
                        placeholder="Arial, sans-serif"
                        data-testid="input-inspector-font-family"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    Double-click any text, link, button, or image in preview to switch editing target.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center text-center p-12 rounded-lg border-2 border-dashed border-muted-foreground/20"
            style={{ width: previewWidth }}
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Code className="w-8 h-8 text-primary/60" />
            </div>
            <p className="text-lg font-medium mb-2">Import Your HTML</p>
            <p className="text-sm text-muted-foreground mb-4">
              Create a new campaign and paste your newsletter HTML to get started
            </p>
            {onCreateCampaign && (
              <Button onClick={onCreateCampaign} data-testid="button-import-html-empty">
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

registerEditorPlugin({
  id: "raw-html",
  name: "HTML Editor",
  description: "Paste and edit raw HTML with inline editing",
  component: HTMLPreviewFrame,
});
