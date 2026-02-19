import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Code, Plus, Monitor, Smartphone, Link2, Type, X } from "lucide-react";
import { registerEditorPlugin, type EditorPluginProps } from "@/lib/editor-plugins";

interface HTMLPreviewFrameProps extends EditorPluginProps {
  title?: string;
  onCreateCampaign?: () => void;
  deviceMode?: DeviceMode;
  onDeviceModeChange?: (mode: DeviceMode) => void;
  showDeviceToggle?: boolean;
}

type DeviceMode = "desktop" | "mobile";

type SelectedElementState = {
  id: string;
  tag: string;
  text: string;
  href: string;
  fontSize: string;
  fontFamily: string;
  canEditText: boolean;
  canEditLink: boolean;
};

const EDIT_ATTR = "data-flow-edit-id";
const EDITABLE_ATTR = "data-flow-editable";
const STYLE_ATTR = "data-flow-editor-style";
const FONT_FAMILY_PRESETS = [
  "Arial, sans-serif",
  "Helvetica, Arial, sans-serif",
  "Georgia, serif",
  "\"Times New Roman\", serif",
  "Verdana, sans-serif",
  "\"Trebuchet MS\", sans-serif",
] as const;

function createEditId(): string {
  return `flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toPixelValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^\d+$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

function getEditableTarget(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  const candidate = element.closest<HTMLElement>(
    "a,button,h1,h2,h3,h4,h5,h6,p,span,td,th,li"
  );

  if (!candidate) return null;
  if (candidate.tagName === "BODY" || candidate.tagName === "HTML") return null;
  const textLength = (candidate.textContent || "").trim().length;
  const tag = candidate.tagName.toLowerCase();
  if (!["a", "button"].includes(tag) && (textLength === 0 || textLength > 600)) return null;

  return candidate;
}

export function HTMLPreviewFrame({
  html,
  isLoading,
  onHtmlChange,
  onCreateCampaign,
  deviceMode,
  onDeviceModeChange,
  showDeviceToggle = true,
  fullWidth = false,
}: HTMLPreviewFrameProps) {
  const [internalDeviceMode, setInternalDeviceMode] = useState<DeviceMode>("desktop");
  const [selectedElement, setSelectedElement] = useState<SelectedElementState | null>(null);
  const selectedRef = useRef<SelectedElementState | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeDeviceMode = deviceMode ?? internalDeviceMode;
  const setActiveDeviceMode = onDeviceModeChange ?? setInternalDeviceMode;

  const previewWidth = activeDeviceMode === "mobile" ? 390 : fullWidth ? "100%" : 680;
  const previewMaxWidth = activeDeviceMode === "mobile" ? 390 : fullWidth ? 980 : 680;

  useEffect(() => {
    selectedRef.current = selectedElement;
  }, [selectedElement]);

  const getFullHtml = useCallback((): string => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return html;
    const clone = iframe.contentDocument.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`[${STYLE_ATTR}]`).forEach((node) => node.remove());
    clone.querySelectorAll<HTMLElement>("*").forEach((node) => {
      node.removeAttribute(EDITABLE_ATTR);
      node.removeAttribute(EDIT_ATTR);
      node.removeAttribute("data-flow-selected");
      node.removeAttribute("contenteditable");
      node.removeAttribute("spellcheck");
    });
    return `<!DOCTYPE html>${clone.outerHTML}`;
  }, [html]);

  const emitHtmlChange = useCallback(() => {
    if (!onHtmlChange) return;
    onHtmlChange(getFullHtml());
  }, [onHtmlChange, getFullHtml]);

  const queuePersist = useCallback(() => {
    if (!onHtmlChange) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      emitHtmlChange();
    }, 320);
  }, [emitHtmlChange, onHtmlChange]);

  const syncHeight = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;
    const bodyHeight = doc.body?.scrollHeight || 0;
    const htmlHeight = doc.documentElement?.scrollHeight || 0;
    const nextHeight = Math.max(bodyHeight, htmlHeight, 640);
    iframe.style.height = `${nextHeight}px`;
  }, []);

  const markSelectedElement = useCallback((id?: string) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll(`[data-flow-selected="true"]`).forEach((node) => {
      node.removeAttribute("data-flow-selected");
    });
    if (!id) return;
    const node = doc.querySelector<HTMLElement>(`[${EDIT_ATTR}="${id}"]`);
    if (node) {
      node.setAttribute("data-flow-selected", "true");
    }
  }, []);

  useEffect(() => {
    markSelectedElement(selectedElement?.id);
  }, [selectedElement?.id, markSelectedElement]);

  useEffect(() => {
    // Reflow iframe after device mode switches so desktop/mobile toggles don't keep stale sizing.
    const timeout = setTimeout(() => syncHeight(), 50);
    return () => clearTimeout(timeout);
  }, [activeDeviceMode, syncHeight, html]);

  const describeElement = useCallback((element: HTMLElement): SelectedElementState => {
    const id = element.getAttribute(EDIT_ATTR) || createEditId();
    element.setAttribute(EDIT_ATTR, id);

    const tag = element.tagName.toLowerCase();
    const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
    const linkElement =
      (tag === "a" ? element : element.closest("a")) || (element.querySelector("a") as HTMLElement | null);

    return {
      id,
      tag,
      text: element.textContent || "",
      href: linkElement?.getAttribute("href") || "",
      fontSize: element.style.fontSize || computed?.fontSize || "",
      fontFamily: element.style.fontFamily || computed?.fontFamily || "",
      canEditText: true,
      canEditLink: true,
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
        markSelectedElement();
        return;
      }

      if (patch.text !== undefined && selectedRef.current.canEditText) {
        element.textContent = patch.text;
      }

      if (patch.href !== undefined && selectedRef.current.canEditLink) {
        const linkElement = (
          (element.tagName.toLowerCase() === "a" ? element : element.closest("a")) ||
          element.querySelector("a")
        ) as HTMLAnchorElement | null;
        const nextHref = patch.href.trim();
        if (nextHref) {
          if (linkElement) {
            linkElement.setAttribute("href", nextHref);
          } else {
            const anchor = doc.createElement("a");
            anchor.setAttribute("href", nextHref);
            anchor.setAttribute("target", "_blank");
            anchor.setAttribute("rel", "noopener noreferrer");
            if (element.childNodes.length === 0) {
              anchor.textContent = selectedRef.current.text || "Link";
            } else {
              while (element.firstChild) {
                anchor.appendChild(element.firstChild);
              }
            }
            element.appendChild(anchor);
          }
        } else if (linkElement) {
          if (linkElement === element) {
            linkElement.removeAttribute("href");
          } else {
            const parent = linkElement.parentNode;
            while (linkElement.firstChild) {
              parent?.insertBefore(linkElement.firstChild, linkElement);
            }
            parent?.removeChild(linkElement);
          }
        }
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
      markSelectedElement(nextState.id);
      syncHeight();
      queuePersist();
    },
    [describeElement, markSelectedElement, queuePersist, syncHeight]
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;

    let mountedDoc: Document | null = null;

    const markEditableElements = (doc: Document) => {
      doc
        .querySelectorAll<HTMLElement>("a,button,h1,h2,h3,h4,h5,h6,p,span,td,th,li")
        .forEach((node) => {
          const tag = node.tagName.toLowerCase();
          const textLength = (node.textContent || "").trim().length;
          const hasText = (node.textContent || "").trim().length > 0;
          const shouldMark = tag === "a" || tag === "button" || (hasText && textLength <= 600);
          if (shouldMark) {
            if (node.getAttribute(EDITABLE_ATTR) !== "true") {
              node.setAttribute(EDITABLE_ATTR, "true");
            }
          } else {
            node.removeAttribute(EDITABLE_ATTR);
          }
        });
    };

    const handleSelect = (event: MouseEvent) => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const target = event.target as HTMLElement | null;
      const editable = getEditableTarget(target);
      if (!editable) {
        setSelectedElement(null);
        markSelectedElement();
        return;
      }

      const snapshot = describeElement(editable);
      selectedRef.current = snapshot;
      setSelectedElement(snapshot);
      markSelectedElement(snapshot.id);

      event.preventDefault();
      event.stopPropagation();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedElement(null);
        markSelectedElement();
      }
    };

    const handleLoad = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      mountedDoc = doc;

      doc.body.style.margin = doc.body.style.margin || "0";
      doc.body.style.background = "#ffffff";

      const style = doc.createElement("style");
      style.setAttribute(STYLE_ATTR, "true");
      style.textContent = `
        [${EDITABLE_ATTR}="true"] {
          cursor: pointer;
        }
        [${EDIT_ATTR}][data-flow-selected="true"] {
          box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.82), 0 0 0 1px rgba(15, 23, 42, 0.15);
        }
        [${EDIT_ATTR}] {
          scroll-margin-top: 80px;
        }
      `;
      doc.head.appendChild(style);

      markEditableElements(doc);

      doc.addEventListener("click", handleSelect, true);
      doc.addEventListener("dblclick", handleSelect, true);
      doc.addEventListener("keydown", handleKeyDown, true);

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
        mountedDoc.removeEventListener("click", handleSelect, true);
        mountedDoc.removeEventListener("dblclick", handleSelect, true);
        mountedDoc.removeEventListener("keydown", handleKeyDown, true);
      }
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [html, describeElement, markSelectedElement, syncHeight]);

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      <div className={`flex-1 flex items-start justify-center overflow-y-auto overflow-x-hidden bg-muted/20 ${fullWidth ? "p-3" : "p-4"}`}>
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
          <div className="space-y-3" style={{ width: previewWidth, maxWidth: previewMaxWidth }}>
            <div
              className={`relative bg-white overflow-hidden transition-all duration-300 ${
                activeDeviceMode === "mobile"
                  ? "rounded-3xl border-4 border-gray-700 shadow-lg"
                  : fullWidth
                    ? "rounded-xl shadow-sm"
                    : "rounded-lg shadow-lg"
              }`}
            >
              <iframe
                ref={iframeRef}
                srcDoc={html}
                title="Newsletter Preview"
                className="w-full border-0 bg-white"
                style={{ height: activeDeviceMode === "mobile" ? "667px" : "680px" }}
                sandbox="allow-same-origin allow-scripts"
                scrolling="no"
                data-testid="iframe-preview"
              />

              {showDeviceToggle && (
                <div className="absolute left-3 top-3 z-20 flex items-center gap-1 bg-background/95 backdrop-blur-sm rounded-full p-1 shadow border border-border/80">
                  <Button
                    size="icon"
                    variant={activeDeviceMode === "desktop" ? "secondary" : "ghost"}
                    onClick={() => setActiveDeviceMode("desktop")}
                    className="rounded-full"
                    data-testid="button-device-desktop"
                  >
                    <Monitor className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant={activeDeviceMode === "mobile" ? "secondary" : "ghost"}
                    onClick={() => setActiveDeviceMode("mobile")}
                    className="rounded-full"
                    data-testid="button-device-mobile"
                  >
                    <Smartphone className="w-4 h-4" />
                  </Button>
                </div>
              )}

              {selectedElement && (
                <div className="absolute right-3 bottom-3 z-20 w-72 rounded-xl border bg-background/95 backdrop-blur-sm shadow-lg" data-testid="panel-element-inspector">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <div className="text-xs font-medium">Edit {selectedElement.tag}</div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        setSelectedElement(null);
                        markSelectedElement();
                      }}
                      data-testid="button-close-inspector"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="space-y-2.5 p-3 max-h-[58vh] overflow-y-auto">
                    {selectedElement.canEditText && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                          <Type className="inline w-3 h-3 mr-1" />
                          Text
                        </label>
                        <Textarea
                          value={selectedElement.text}
                          onChange={(event) => applySelectedElementUpdate({ text: event.target.value })}
                          className="min-h-[90px] text-xs bg-card"
                          data-testid="input-inspector-text"
                        />
                      </div>
                    )}

                    {selectedElement.canEditLink && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                          <Link2 className="inline w-3 h-3 mr-1" />
                          Link
                        </label>
                        <Input
                          value={selectedElement.href}
                          onChange={(event) => applySelectedElementUpdate({ href: event.target.value })}
                          className="h-8 text-xs bg-card"
                          placeholder="https://..."
                          data-testid="input-inspector-link"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Font size</label>
                        <Input
                          value={selectedElement.fontSize}
                          onChange={(event) => applySelectedElementUpdate({ fontSize: event.target.value })}
                          className="h-8 text-xs bg-card"
                          placeholder="16px"
                          data-testid="input-inspector-font-size"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Font family</label>
                        <Input
                          list="flow-font-family-presets"
                          value={selectedElement.fontFamily}
                          onChange={(event) => applySelectedElementUpdate({ fontFamily: event.target.value })}
                          className="h-8 text-xs bg-card"
                          placeholder="Arial, sans-serif"
                          data-testid="input-inspector-font-family"
                        />
                      </div>
                    </div>
                    <datalist id="flow-font-family-presets">
                      {FONT_FAMILY_PRESETS.map((font) => (
                        <option key={font} value={font} />
                      ))}
                    </datalist>
                  </div>
                </div>
              )}
            </div>
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
