import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Loader2, Calendar } from "lucide-react";
import { format, addDays, startOfDay } from "date-fns";

interface CreateNewsletterDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { expectedSendDate: string }) => Promise<void>;
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

  const today = startOfDay(new Date());
  const next30Days = Array.from({ length: 30 }, (_, i) => addDays(today, i + 1));

  const handleSubmit = async () => {
    if (!selectedDate) return;
    await onSubmit({
      expectedSendDate: format(selectedDate, "yyyy-MM-dd"),
    });
    setSelectedDate(null);
  };

  const handleClose = () => {
    setSelectedDate(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Launch New Campaign</DialogTitle>
          <DialogDescription>
            {clientName ? `Schedule a newsletter for ${clientName}` : "Select a send date"}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" />
            <span>Select send date</span>
          </div>
          <ScrollArea className="h-64 rounded-lg border">
            <div className="p-2 space-y-1">
              {next30Days.map((date) => {
                const isSelected = selectedDate && 
                  format(selectedDate, "yyyy-MM-dd") === format(date, "yyyy-MM-dd");
                const dayOfWeek = format(date, "EEE");
                const dayMonth = format(date, "MMM d");
                
                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    onClick={() => setSelectedDate(date)}
                    data-testid={`date-option-${format(date, "yyyy-MM-dd")}`}
                    className={cn(
                      "w-full flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors",
                      "hover-elevate active-elevate-2",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-transparent"
                    )}
                  >
                    <span className="font-medium">{dayMonth}</span>
                    <span className={cn(
                      "text-sm",
                      isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}>
                      {dayOfWeek}
                    </span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
            Cancel
          </Button>
          <Button 
            type="button" 
            onClick={handleSubmit} 
            disabled={isSubmitting || !selectedDate} 
            className="flex-1 bg-primary"
            data-testid="button-start-campaign"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Start Campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
