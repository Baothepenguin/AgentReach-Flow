import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Loader2, Calendar, Code, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays, startOfDay, addWeeks, startOfWeek, endOfWeek, isSameDay, isSameMonth } from "date-fns";

interface CreateNewsletterDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { expectedSendDate: string; importedHtml?: string }) => Promise<void>;
  isSubmitting?: boolean;
  clientName?: string;
}

export function CreateNewsletterDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  clientName,
}: CreateNewsletterDialogProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [importedHtml, setImportedHtml] = useState("");
  const [activeTab, setActiveTab] = useState<"blank" | "import">("blank");
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0);

  const today = startOfDay(new Date());
  const currentWeekStart = startOfWeek(addWeeks(today, calendarWeekOffset), { weekStartsOn: 0 });
  const weeks = Array.from({ length: 4 }, (_, weekIdx) => {
    const weekStart = addWeeks(currentWeekStart, weekIdx);
    return Array.from({ length: 7 }, (_, dayIdx) => addDays(weekStart, dayIdx));
  });

  const handleSubmit = async () => {
    if (!selectedDate) return;
    await onSubmit({
      expectedSendDate: format(selectedDate, "yyyy-MM-dd"),
      importedHtml: activeTab === "import" && importedHtml.trim() ? importedHtml : undefined,
    });
    setSelectedDate(null);
    setImportedHtml("");
    setActiveTab("blank");
    setCalendarWeekOffset(0);
  };

  const handleClose = () => {
    setSelectedDate(null);
    setImportedHtml("");
    setActiveTab("blank");
    setCalendarWeekOffset(0);
    onClose();
  };

  const monthLabel = format(currentWeekStart, "MMMM yyyy");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg glass-card">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">New Campaign</DialogTitle>
          <DialogDescription>
            {clientName ? `Create newsletter for ${clientName}` : "Select a send date"}
          </DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "blank" | "import")} className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="blank" className="flex-1 gap-2" data-testid="tab-blank-newsletter">
              <Calendar className="w-4 h-4" />
              Start Fresh
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1 gap-2" data-testid="tab-import-html">
              <Code className="w-4 h-4" />
              Import HTML
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="mt-4">
            <Textarea
              placeholder="Paste your email HTML here..."
              value={importedHtml}
              onChange={(e) => setImportedHtml(e.target.value)}
              className="min-h-[160px] font-mono text-xs"
              data-testid="textarea-import-html"
            />
          </TabsContent>

          <TabsContent value="blank" className="mt-4">
            <p className="text-sm text-muted-foreground mb-3">
              Start with a blank canvas or use your latest template.
            </p>
          </TabsContent>
        </Tabs>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Send Date</span>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setCalendarWeekOffset(Math.max(0, calendarWeekOffset - 4))}
                disabled={calendarWeekOffset === 0}
                data-testid="button-prev-month"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground min-w-[120px] text-center">{monthLabel}</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setCalendarWeekOffset(calendarWeekOffset + 4)}
                data-testid="button-next-month"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="text-center text-xs text-muted-foreground py-1">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-1">
            {weeks.flat().map((date) => {
              const isSelected = selectedDate && isSameDay(selectedDate, date);
              const isPast = date < today;
              const isCurrentMonth = isSameMonth(date, currentWeekStart);
              
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => !isPast && setSelectedDate(date)}
                  disabled={isPast}
                  data-testid={`date-option-${format(date, "yyyy-MM-dd")}`}
                  className={cn(
                    "aspect-square rounded-md text-sm flex items-center justify-center transition-all",
                    isPast && "opacity-30 cursor-not-allowed",
                    !isPast && !isSelected && "hover-elevate cursor-pointer",
                    isSelected && "bg-primary text-primary-foreground glow-green",
                    !isSelected && !isPast && !isCurrentMonth && "text-muted-foreground/50"
                  )}
                >
                  {format(date, "d")}
                </button>
              );
            })}
          </div>
          
          {selectedDate && (
            <div className="mt-3 text-center text-sm text-primary font-medium">
              {format(selectedDate, "EEEE, MMMM d, yyyy")}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 mt-4">
          <Button type="button" variant="outline" onClick={handleClose} className="flex-1" data-testid="button-cancel-campaign">
            Cancel
          </Button>
          <Button 
            type="button" 
            onClick={handleSubmit} 
            disabled={isSubmitting || !selectedDate} 
            className="flex-1 glow-green-hover"
            data-testid="button-start-campaign"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
