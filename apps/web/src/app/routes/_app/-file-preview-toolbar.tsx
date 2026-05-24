import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";

export function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-pressed={pressed}
            aria-label={label}
            title={label}
            onClick={onClick}
          />
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
