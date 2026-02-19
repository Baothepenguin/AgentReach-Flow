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
    "a,button,h1,h2,h3,h4,h5,h6,p,span,td,th,li,div"
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
  deviceMode,
  onDeviceModeChange,
  showDeviceToggle = true,
  fullWidth = false,
}: HTMLPreviewFrameProps) {
  const [internalDeviceMode, setInternalDeviceMode] = useState<DeviceMode>("desktop");
  const [selectedElement, setSelectedElement] = useState<SelectedElementState | null>(null);
  const selectedRef = useRef<SelectedElementState | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeDeviceMode = deviceMode ?? internalDeviceMode;
  const setActiveDeviceMode = onDeviceModeChange ?? setInternalDeviceMode;

  const previewWidth = fullWidth ? "100%" : activeDeviceMode === "mobile" ? 375 : 680;

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
      emitHtmlChange();
    },
    [describeElement, emitHtmlChange, markSelectedElement, syncHeight]
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
      }, 220);
    };

    const markEditableElements = (doc: Document) => {
      doc
        .querySelectorAll<HTMLElement>("a,button,h1,h2,h3,h4,h5,h6,p,span,td,th,li,div")
        .forEach((node) => {
          const hasText = (node.textContent || "").trim().length > 0;
          const shouldMark = hasText || Boolean(node.closest("a"));
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
      markSelectedElement(snapshot.id);

      if (snapshot.canEditText) {
        editable.setAttribute("contenteditable", "true");
        editable.setAttribute("spellcheck", "true");
        editable.focus();
      }

      event.preventDefault();
      scheduleSave();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedElement(null);
        markSelectedElement();
      }
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
        [${EDIT_ATTR}][data-flow-selected="true"] {
          outline: 2px solid hsl(143 59% 33% / 0.9);
          outline-offset: 1px;
          box-shadow: 0 0 0 3px hsl(143 59% 33% / 0.18);
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
      doc.addEventListener("keydown", handleKeyDown, true);

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
        mountedDoc.removeEventListener("keydown", handleKeyDown, true);
      }
      if (observer) observer.disconnect();
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [html, describeElement, emitHtmlChange, markSelectedElement, onHtmlChange, syncHeight]);

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
          <div className="space-y-3" style={{ width: previewWidth, maxWidth: fullWidth ? undefined : previewWidth }}>
            <div
              className={`relative bg-white overflow-hidden transition-all duration-300 ${
                activeDeviceMode === "mobile" && !fullWidth
                  ? "rounded-3xl border-4 border-gray-700 shadow-lg"
                  : fullWidth
                    ? "rounded-xl border shadow-sm"
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
                <div className="absolute right-3 top-14 z-20 w-80 rounded-xl border bg-background/95 backdrop-blur-sm shadow-lg" data-testid="panel-element-inspector">
                  <div className="flex items-center justify-between border-b px-3 py-2.5">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Live inspector</div>
                      <div className="text-xs font-medium mt-0.5">Edit {selectedElement.tag}</div>
                    </div>
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
                          className="min-h-[90px] text-xs bg-card"
                          data-testid="input-inspector-text"
                        />
                      </div>
                    )}

                    {selectedElement.canEditLink && (
                      <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
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
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Font size</label>
                        <Input
                          value={selectedElement.fontSize}
                          onChange={(event) => applySelectedElementUpdate({ fontSize: event.target.value })}
                          className="h-8 text-xs bg-card"
                          placeholder="16px"
                          data-testid="input-inspector-font-size"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Font family</label>
                        <Input
                          value={selectedElement.fontFamily}
                          onChange={(event) => applySelectedElementUpdate({ fontFamily: event.target.value })}
                          className="h-8 text-xs bg-card"
                          placeholder="Arial, sans-serif"
                          data-testid="input-inspector-font-family"
                        />
                      </div>
                    </div>

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
