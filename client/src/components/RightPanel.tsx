import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ModuleCard } from "./ModuleCard";
import { SourceCard } from "./SourceCard";
import { WarningsPanel } from "./WarningsPanel";
import { VersionHistory } from "./VersionHistory";
import { Layers, Sparkles, Link2, AlertTriangle, History, Plus } from "lucide-react";
import type { NewsletterModule, AIDraftSource, TasksFlags, NewsletterVersion, AiDraft } from "@shared/schema";

interface RightPanelProps {
  modules: NewsletterModule[];
  sources: AIDraftSource[];
  flags: TasksFlags[];
  versions: NewsletterVersion[];
  aiDrafts: AiDraft[];
  currentVersionId: string | null;
  selectedModuleId: string | null;
  onSelectModule: (id: string | null) => void;
  onEditModule: (id: string) => void;
  onDeleteModule: (id: string) => void;
  onReorderModules: (modules: NewsletterModule[]) => void;
  onAddModule: () => void;
  onRestoreVersion: (versionId: string) => void;
  onResolveFlag: (flagId: string) => void;
  onApplyAIDraft: (draftId: string) => void;
}

export function RightPanel({
  modules,
  sources,
  flags,
  versions,
  aiDrafts,
  currentVersionId,
  selectedModuleId,
  onSelectModule,
  onEditModule,
  onDeleteModule,
  onAddModule,
  onRestoreVersion,
  onResolveFlag,
  onApplyAIDraft,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState("modules");

  const activeFlags = flags.filter((f) => !f.resolvedAt);
  const hasBlockers = activeFlags.some((f) => f.severity === "blocker");

  return (
    <div className="flex flex-col h-full bg-sidebar border-l border-sidebar-border">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <div className="border-b border-sidebar-border px-2">
          <TabsList className="w-full h-auto p-1 bg-transparent gap-0">
            <TabsTrigger
              value="modules"
              className="flex-1 text-xs gap-1.5 data-[state=active]:bg-sidebar-accent"
              data-testid="tab-modules"
            >
              <Layers className="w-3.5 h-3.5" />
              Modules
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              className="flex-1 text-xs gap-1.5 data-[state=active]:bg-sidebar-accent"
              data-testid="tab-ai"
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI
              {aiDrafts.length > 0 && (
                <span className="ml-1 w-4 h-4 text-[10px] rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                  {aiDrafts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="sources"
              className="flex-1 text-xs gap-1.5 data-[state=active]:bg-sidebar-accent"
              data-testid="tab-sources"
            >
              <Link2 className="w-3.5 h-3.5" />
              Sources
            </TabsTrigger>
            <TabsTrigger
              value="warnings"
              className="flex-1 text-xs gap-1.5 data-[state=active]:bg-sidebar-accent relative"
              data-testid="tab-warnings"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Flags
              {activeFlags.length > 0 && (
                <span
                  className={`ml-1 w-4 h-4 text-[10px] rounded-full flex items-center justify-center ${
                    hasBlockers
                      ? "bg-red-500 text-white"
                      : "bg-amber-500 text-white"
                  }`}
                >
                  {activeFlags.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="flex-1 text-xs gap-1.5 data-[state=active]:bg-sidebar-accent"
              data-testid="tab-history"
            >
              <History className="w-3.5 h-3.5" />
              History
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="modules" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3 space-y-2">
              {modules.map((module) => (
                <ModuleCard
                  key={module.id}
                  module={module}
                  isSelected={module.id === selectedModuleId}
                  onSelect={() => onSelectModule(module.id)}
                  onEdit={() => onEditModule(module.id)}
                  onDelete={() => onDeleteModule(module.id)}
                />
              ))}
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={onAddModule}
                data-testid="button-add-module"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Module
              </Button>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="ai" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3 space-y-3">
              {aiDrafts.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
                  <p>No AI drafts yet</p>
                  <p className="text-xs mt-1">Use the AI command to generate content</p>
                </div>
              ) : (
                aiDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="p-3 rounded-lg bg-card border border-card-border"
                    data-testid={`ai-draft-${draft.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{draft.intent}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(draft.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => onApplyAIDraft(draft.id)}
                        data-testid={`button-apply-draft-${draft.id}`}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="sources" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3 space-y-2">
              {sources.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Link2 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
                  <p>No sources yet</p>
                  <p className="text-xs mt-1">Sources appear when AI generates content</p>
                </div>
              ) : (
                sources.map((source) => (
                  <SourceCard key={source.id} source={source} />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="warnings" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3">
              <WarningsPanel flags={flags} onResolve={onResolveFlag} />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="history" className="flex-1 m-0 overflow-hidden">
          <VersionHistory
            versions={versions}
            currentVersionId={currentVersionId}
            onRestore={onRestoreVersion}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
