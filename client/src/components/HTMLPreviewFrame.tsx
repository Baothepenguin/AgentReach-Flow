import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Monitor, Tablet, Smartphone, ExternalLink, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface HTMLPreviewFrameProps {
  html: string;
  isLoading?: boolean;
  title?: string;
}

type DeviceSize = "desktop" | "tablet" | "mobile";

const deviceSizes: Record<DeviceSize, { width: number; icon: typeof Monitor }> = {
  desktop: { width: 680, icon: Monitor },
  tablet: { width: 768, icon: Tablet },
  mobile: { width: 375, icon: Smartphone },
};

export function HTMLPreviewFrame({ html, isLoading, title }: HTMLPreviewFrameProps) {
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const openInNewTab = () => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b bg-card">
        <div className="flex items-center gap-1">
          {(Object.keys(deviceSizes) as DeviceSize[]).map((d) => {
            const { icon: Icon } = deviceSizes[d];
            return (
              <Button
                key={d}
                size="icon"
                variant={device === d ? "secondary" : "ghost"}
                onClick={() => setDevice(d)}
                data-testid={`button-device-${d}`}
              >
                <Icon className="w-4 h-4" />
              </Button>
            );
          })}
        </div>
        {title && (
          <span className="text-sm font-medium text-muted-foreground truncate mx-4">
            {title}
          </span>
        )}
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={openInNewTab}
            data-testid="button-preview-new-tab"
          >
            <ExternalLink className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsFullscreen(!isFullscreen)}
            data-testid="button-preview-fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 bg-muted/30 overflow-auto">
        {isLoading ? (
          <div
            className="bg-white rounded-lg shadow-2xl overflow-hidden"
            style={{ width: deviceSizes[device].width }}
          >
            <Skeleton className="h-48 w-full" />
            <div className="p-4 space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "bg-white rounded-lg shadow-2xl overflow-hidden transition-all duration-300",
              isFullscreen && "fixed inset-4 z-50 m-0 rounded-none"
            )}
            style={{ width: isFullscreen ? "100%" : deviceSizes[device].width }}
          >
            <iframe
              srcDoc={html}
              title="Newsletter Preview"
              className="w-full h-full min-h-[600px] border-0"
              sandbox="allow-same-origin"
              data-testid="iframe-preview"
            />
          </div>
        )}
      </div>
    </div>
  );
}
