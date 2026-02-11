import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Settings2,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type { NewsletterChatMessage, AiPrompt } from "@shared/schema";

interface GeminiChatPanelProps {
  newsletterId: string;
  clientId: string;
  clientName: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function GeminiChatPanel({
  newsletterId,
  clientId,
  clientName,
  collapsed,
  onToggleCollapse,
}: GeminiChatPanelProps) {
  const [message, setMessage] = useState("");
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [masterPromptDraft, setMasterPromptDraft] = useState("");
  const [clientPromptDraft, setClientPromptDraft] = useState("");
  const [promptsLoaded, setPromptsLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: aiStatus } = useQuery<{ geminiConfigured: boolean; openaiConfigured: boolean; postmarkConfigured: boolean }>({
    queryKey: ["/api/integrations/ai-status"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/ai-status", { credentials: "include" });
      if (!res.ok) {
        return { geminiConfigured: false, openaiConfigured: false, postmarkConfigured: false };
      }
      return res.json();
    },
    enabled: !collapsed,
  });

  const { data: chatMessages = [], isLoading: loadingMessages } = useQuery<NewsletterChatMessage[]>({
    queryKey: ["/api/newsletters", newsletterId, "chat"],
    queryFn: async () => {
      const res = await fetch(`/api/newsletters/${newsletterId}/chat`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !collapsed,
  });

  const { data: masterPrompt } = useQuery<AiPrompt | null>({
    queryKey: ["/api/ai-prompts/master"],
    queryFn: async () => {
      const res = await fetch("/api/ai-prompts/master", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !collapsed,
  });

  const { data: clientPrompt } = useQuery<AiPrompt | null>({
    queryKey: ["/api/clients", clientId, "ai-prompt"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/ai-prompt`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !collapsed && !!clientId,
  });

  useEffect(() => {
    if (!promptsLoaded && (masterPrompt !== undefined || clientPrompt !== undefined)) {
      setMasterPromptDraft(masterPrompt?.prompt || "");
      setClientPromptDraft(clientPrompt?.prompt || "");
      setPromptsLoaded(true);
    }
  }, [masterPrompt, clientPrompt, promptsLoaded]);

  const sendMessageMutation = useMutation({
    mutationFn: async (msg: string) => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/chat`, { message: msg });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "chat"] });
      setMessage("");
    },
    onError: (error: Error) => {
      toast({
        title: "AI chat failed",
        description: error.message || "Could not send message to AI. Check integrations and try again.",
        variant: "destructive",
      });
    },
  });

  const clearChatMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/newsletters/${newsletterId}/chat`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "chat"] });
    },
  });

  const saveMasterPromptMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("PUT", "/api/ai-prompts/master", { prompt });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-prompts/master"] });
    },
  });

  const saveClientPromptMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("PUT", `/api/clients/${clientId}/ai-prompt`, { prompt });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "ai-prompt"] });
    },
  });

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, scrollToBottom]);

  const handleSend = () => {
    if (!message.trim() || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate(message.trim());
  };

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-l bg-background">
        <Button
          variant="ghost"
          size="icon"
          className="mt-3"
          onClick={onToggleCollapse}
          data-testid="button-expand-chat"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="mt-4 -rotate-90 whitespace-nowrap text-xs text-muted-foreground font-medium">
          AI Chat
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 flex-shrink-0 border-l flex flex-col bg-background" data-testid="panel-gemini-chat">
      <div className="flex items-center justify-between px-3 h-12 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI Chat</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowPromptEditor(!showPromptEditor)}
            data-testid="button-toggle-prompts"
          >
            <Settings2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => clearChatMutation.mutate()}
            disabled={chatMessages.length === 0}
            data-testid="button-clear-chat"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            data-testid="button-collapse-chat"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {aiStatus && (
        <div className="px-3 py-2 border-b text-xs flex items-center gap-1.5">
          {aiStatus.geminiConfigured ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-muted-foreground">Gemini connected</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-muted-foreground">Gemini not configured — chat replies will be limited.</span>
            </>
          )}
        </div>
      )}

      {showPromptEditor && (
        <div className="border-b overflow-auto max-h-64">
          <PromptSection
            title="Master Prompt"
            subtitle="Applies to all newsletters"
            value={masterPromptDraft}
            onChange={setMasterPromptDraft}
            onSave={() => saveMasterPromptMutation.mutate(masterPromptDraft)}
            isSaving={saveMasterPromptMutation.isPending}
            testId="master-prompt"
          />
          <PromptSection
            title={`Client Prompt — ${clientName}`}
            subtitle="Only for this client's newsletters"
            value={clientPromptDraft}
            onChange={setClientPromptDraft}
            onSave={() => saveClientPromptMutation.mutate(clientPromptDraft)}
            isSaving={saveClientPromptMutation.isPending}
            testId="client-prompt"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto" ref={scrollRef}>
        <div className="p-3 space-y-3">
          {loadingMessages ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Start a conversation</p>
              <p className="text-xs mt-1">Ask about content, strategy, or get writing help</p>
            </div>
          ) : (
            chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`chat-message-${msg.id}`}
              >
                <div
                  className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              </div>
            ))
          )}
          {sendMessageMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-md px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-3 border-t">
        <div className="flex gap-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask AI..."
            className="min-h-[40px] max-h-32 resize-none text-sm"
            disabled={sendMessageMutation.isPending}
            data-testid="input-chat-message"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!message.trim() || sendMessageMutation.isPending}
            data-testid="button-send-chat"
          >
            {sendMessageMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PromptSection({
  title,
  subtitle,
  value,
  onChange,
  onSave,
  isSaving,
  testId,
}: {
  title: string;
  subtitle: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  isSaving: boolean;
  testId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-3 py-2 border-b last:border-b-0">
      <button
        className="flex items-center justify-between w-full text-left"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-toggle-${testId}`}
      >
        <div>
          <p className="text-xs font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter system prompt..."
            className="min-h-[80px] text-xs resize-none"
            data-testid={`textarea-${testId}`}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={onSave}
            disabled={isSaving}
            data-testid={`button-save-${testId}`}
          >
            {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
