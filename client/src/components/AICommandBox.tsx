import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sparkles, Send, Loader2, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AICommandBoxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (command: string) => Promise<void>;
  selectedModuleId?: string | null;
  isProcessing?: boolean;
  response?: {
    type: "success" | "clarification" | "error";
    message: string;
    options?: string[];
  } | null;
}

export function AICommandBox({
  open,
  onOpenChange,
  onSubmit,
  selectedModuleId,
  isProcessing,
  response,
}: AICommandBoxProps) {
  const [command, setCommand] = useState("");

  const handleSubmit = async () => {
    if (!command.trim() || isProcessing) return;
    await onSubmit(command.trim());
    if (response?.type === "success") {
      setCommand("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI Command
          </DialogTitle>
          <DialogDescription>
            Describe what you want to change. Be specific about which modules to modify.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {selectedModuleId && (
            <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg text-sm">
              <span className="text-muted-foreground">Target:</span>
              <code className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">
                {selectedModuleId}
              </code>
            </div>
          )}
          <div className="relative">
            <Textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., 'Update the hero title to say Welcome to January' or 'Add 3 local events for this month'"
              className="min-h-[120px] resize-none pr-12"
              disabled={isProcessing}
              data-testid="input-ai-command"
            />
            <Button
              size="icon"
              className="absolute bottom-2 right-2"
              onClick={handleSubmit}
              disabled={!command.trim() || isProcessing}
              data-testid="button-submit-ai-command"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          {response && (
            <div
              className={cn(
                "p-4 rounded-lg border",
                response.type === "success" && "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800",
                response.type === "clarification" && "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800",
                response.type === "error" && "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
              )}
            >
              <div className="flex items-start gap-2">
                {response.type === "success" && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                )}
                {response.type === "clarification" && (
                  <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                )}
                {response.type === "error" && (
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <p className="text-sm">{response.message}</p>
                  {response.options && response.options.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {response.options.map((option, i) => (
                        <Button
                          key={i}
                          size="sm"
                          variant="secondary"
                          onClick={() => setCommand(option)}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Press Cmd+Enter to send</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              <X className="w-3 h-3 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
