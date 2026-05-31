import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@/shared/lib/utils";

function RadioGroup({
  className,
  ...props
}: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  children,
  ...props
}: Radio.Root.Props) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      className={cn(
        "group/radio flex items-center gap-2 cursor-pointer",
        className,
      )}
      {...props}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[checked]/radio:border-primary group-data-[disabled]/radio:cursor-not-allowed group-data-[disabled]/radio:opacity-50">
        <Radio.Indicator className="size-2 rounded-full bg-primary data-[unchecked]:hidden" />
      </span>
      {children}
    </Radio.Root>
  );
}

export { RadioGroup, RadioGroupItem };
