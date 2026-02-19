import { useState, useRef, useEffect, useCallback, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Code, Plus, Monitor, Smartphone, Link2, Type, X, Palette, Image as ImageIcon, Upload, Loader2 } from "lucide-react";
import { registerEditorPlugin, type EditorPluginProps } from "@/lib/editor-plugins";
import { useToast } from "@/hooks/use-toast";

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
  color: string;
  imageSrc: string;
  imageAlt: string;
  canEditText: boolean;
  canEditLink: boolean;
  canEditColor: boolean;
  canEditImage: boolean;
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

function normalizeColorToHex(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "#111827";
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed.charAt(1);
    const g = trimmed.charAt(2);
    const b = trimmed.charAt(3);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgbMatch) return "#111827";
  const [r, g, b] = rgbMatch[1]
    .split(",")
    .slice(0, 3)
    .map((part) => Math.max(0, Math.min(255, Number.parseInt(part.trim(), 10) || 0)));
  const toHex = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function normalizeUploadedObjectPath(path: string): string {
  if (!path) return path;
  const withoutQuery = path.split("?")[0] || path;
  if (withoutQuery.startsWith("/api/objects/")) return withoutQuery;
  if (withoutQuery.startsWith("/objects/")) {
    return `/api/objects/${withoutQuery.slice("/objects/".length)}`;
  }
  return withoutQuery;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("Unable to read file"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function toPixelValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^\d+$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

function getEditableTarget(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  const candidate = element.closest<HTMLElement>(
    "img,a,button,h1,h2,h3,h4,h5,h6,p,span,td,th,li"
  );

  if (!candidate) return null;
  if (candidate.tagName === "BODY" || candidate.tagName === "HTML") return null;
  if (candidate.tagName.toLowerCase() === "img") return candidate;
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
  const { toast } = useToast();
  const [internalDeviceMode, setInternalDeviceMode] = useState<DeviceMode>("desktop");
  const [selectedElement, setSelectedElement] = useState<SelectedElementState | null>(null);
  const [inspectorPosition, setInspectorPosition] = useState<{ x: number; y: number }>({ x: 18, y: 18 });
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const selectedRef = useRef<SelectedElementState | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
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
    const imageElement =
      (tag === "img" ? element : element.querySelector("img")) as HTMLImageElement | null;

    return {
      id,
      tag,
      text: element.textContent || "",
      href: linkElement?.getAttribute("href") || "",
      fontSize: element.style.fontSize || computed?.fontSize || "",
      fontFamily: element.style.fontFamily || computed?.fontFamily || "",
      color: normalizeColorToHex(element.style.color || computed?.color || ""),
      imageSrc: imageElement?.getAttribute("src") || "",
      imageAlt: imageElement?.getAttribute("alt") || "",
      canEditText: tag !== "img",
      canEditLink: true,
      canEditColor: tag !== "img",
      canEditImage: tag === "img",
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
              if (element.tagName.toLowerCase() === "img") {
                const parent = element.parentNode;
                if (parent) {
                  parent.insertBefore(anchor, element);
                  anchor.appendChild(element);
                }
              } else if (element.childNodes.length === 0) {
                anchor.textContent = selectedRef.current.text || "Link";
              } else {
                while (element.firstChild) {
                  anchor.appendChild(element.firstChild);
                }
              }
              if (element.tagName.toLowerCase() !== "img") {
                element.appendChild(anchor);
              }
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

      if (patch.imageSrc !== undefined && selectedRef.current.canEditImage) {
        const imageElement =
          (element.tagName.toLowerCase() === "img" ? element : element.querySelector("img")) as HTMLImageElement | null;
        if (imageElement) {
          const nextSrc = patch.imageSrc.trim();
          if (nextSrc) {
            imageElement.setAttribute("src", nextSrc);
          }
        }
      }

      if (patch.imageAlt !== undefined && selectedRef.current.canEditImage) {
        const imageElement =
          (element.tagName.toLowerCase() === "img" ? element : element.querySelector("img")) as HTMLImageElement | null;
        if (imageElement) {
          imageElement.setAttribute("alt", patch.imageAlt);
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

      if (patch.color !== undefined && selectedRef.current.canEditColor) {
        const nextColor = patch.color.trim();
        if (nextColor) {
          element.style.color = nextColor;
        } else {
          element.style.removeProperty("color");
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

  const handleImageFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file", variant: "destructive" });
      event.target.value = "";
      return;
    }

    setIsUploadingImage(true);
    try {
      const requestUrlRes = await fetch("/api/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      });

      if (!requestUrlRes.ok) {
        const errorData = await requestUrlRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to prepare image upload");
      }

      const uploadPayload = await requestUrlRes.json();
      const uploadURL =
        typeof uploadPayload?.uploadURL === "string" ? uploadPayload.uploadURL : "";
      const objectPath =
        typeof uploadPayload?.objectPath === "string" ? uploadPayload.objectPath : "";
      const uploadToken =
        typeof uploadPayload?.uploadToken === "string" ? uploadPayload.uploadToken : undefined;
      if (!uploadURL || !objectPath) {
        throw new Error("Upload response missing required fields");
      }

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload image");
      }

      const finalizeRes = await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectPath,
          visibility: "public",
          ...(uploadToken ? { uploadToken } : {}),
        }),
      });

      if (!finalizeRes.ok) {
        const errorData = await finalizeRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to finalize image upload");
      }

      const finalizedPayload = await finalizeRes.json();
      const objectUrl =
        typeof finalizedPayload?.objectUrl === "string" ? finalizedPayload.objectUrl : "";
      const finalizedObjectPath =
        typeof finalizedPayload?.objectPath === "string"
          ? finalizedPayload.objectPath
          : objectPath;

      const src = objectUrl
        ? objectUrl
        : new URL(
            normalizeUploadedObjectPath(finalizedObjectPath),
            window.location.origin,
          ).toString();

      applySelectedElementUpdate({ imageSrc: src });
      toast({ title: "Image updated" });
    } catch (error) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        applySelectedElementUpdate({ imageSrc: dataUrl });
        toast({
          title: "Image updated (local mode)",
          description: "Object storage is unavailable, so this image is embedded in the HTML.",
        });
      } catch {
        const message = error instanceof Error ? error.message : "Upload failed";
        toast({
          title: "Image upload failed",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setIsUploadingImage(false);
      event.target.value = "";
    }
  }, [applySelectedElementUpdate, toast]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;

    let mountedDoc: Document | null = null;

    const markEditableElements = (doc: Document) => {
      doc
        .querySelectorAll<HTMLElement>("img,a,button,h1,h2,h3,h4,h5,h6,p,span,td,th,li")
        .forEach((node) => {
          const tag = node.tagName.toLowerCase();
          const textLength = (node.textContent || "").trim().length;
          const hasText = (node.textContent || "").trim().length > 0;
          const shouldMark = tag === "img" || tag === "a" || tag === "button" || (hasText && textLength <= 600);
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

      const frameWidth = iframe.clientWidth || 680;
      const panelWidth = 288;
      const nextX = Math.max(12, Math.min(event.clientX + 14, frameWidth - panelWidth - 12));
      const nextY = Math.max(12, event.clientY + 14);
      setInspectorPosition({ x: nextX, y: nextY });

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
          transition: outline-color 100ms ease, outline-width 100ms ease;
        }
        [${EDITABLE_ATTR}="true"]:hover {
          outline: 1px solid rgba(22, 163, 74, 0.28);
          outline-offset: -1px;
        }
        [${EDIT_ATTR}][data-flow-selected="true"] {
          outline: 2px solid rgba(22, 163, 74, 0.75);
          outline-offset: -2px;
        }
        [${EDIT_ATTR}] {
          scroll-margin-top: 80px;
        }
      `;
      doc.head.appendChild(style);

      markEditableElements(doc);

      doc.addEventListener("click", handleSelect, true);
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
        mountedDoc.removeEventListener("keydown", handleKeyDown, true);
      }
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [html, describeElement, markSelectedElement, syncHeight]);

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileSelected}
      />
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
                <div
                  className="absolute z-20 w-72 rounded-xl border bg-background/95 backdrop-blur-sm shadow-lg"
                  style={{ left: `${inspectorPosition.x}px`, top: `${inspectorPosition.y}px` }}
                  data-testid="panel-element-inspector"
                >
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
                    {selectedElement.canEditImage && (
                      <div className="space-y-2">
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                          <ImageIcon className="inline w-3 h-3 mr-1" />
                          Image
                        </label>
                        <Input
                          value={selectedElement.imageSrc}
                          onChange={(event) => applySelectedElementUpdate({ imageSrc: event.target.value })}
                          className="h-8 text-xs bg-card"
                          placeholder="https://..."
                          data-testid="input-inspector-image-src"
                        />
                        <Input
                          value={selectedElement.imageAlt}
                          onChange={(event) => applySelectedElementUpdate({ imageAlt: event.target.value })}
                          className="h-8 text-xs bg-card"
                          placeholder="Alt text"
                          data-testid="input-inspector-image-alt"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-full text-xs"
                          onClick={() => imageFileInputRef.current?.click()}
                          disabled={isUploadingImage}
                          data-testid="button-inspector-image-upload"
                        >
                          {isUploadingImage ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-3.5 h-3.5 mr-1.5" />
                              Upload image
                            </>
                          )}
                        </Button>
                      </div>
                    )}

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
                    {selectedElement.canEditColor && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                          <Palette className="inline w-3 h-3 mr-1" />
                          Font color
                        </label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="color"
                            value={normalizeColorToHex(selectedElement.color)}
                            onChange={(event) => applySelectedElementUpdate({ color: event.target.value })}
                            className="h-8 w-10 p-1 bg-card"
                            data-testid="input-inspector-font-color-picker"
                          />
                          <Input
                            value={selectedElement.color}
                            onChange={(event) => applySelectedElementUpdate({ color: event.target.value })}
                            className="h-8 text-xs bg-card"
                            placeholder="#111827"
                            data-testid="input-inspector-font-color"
                          />
                        </div>
                      </div>
                    )}
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
