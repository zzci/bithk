import * as React from "react";

import { Input } from "@/shared/components/ui/input";
import { minorToInput, parseMoneyToMinor } from "@/shared/lib/format";

interface MoneyInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  // Minor-unit integer (e.g. cents); null means unset.
  value: number | null;
  onChange: (value: number | null) => void;
}

// Currency input box. Holds and emits a minor-unit integer while letting the
// user type a two-decimal major-unit amount. While focused it shows a free
// draft so in-progress typing ("12.", "0.0") stays stable; when blurred it
// renders the committed value so the field always settles on a clean
// two-decimal string.
export function MoneyInput({ value, onChange, min = 0, step = "0.01", ...props }: MoneyInputProps) {
  const [draft, setDraft] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const committed = value === null ? "" : minorToInput(value);

  return (
    <Input
      {...props}
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      value={focused ? draft : committed}
      onFocus={() => {
        setDraft(committed);
        setFocused(true);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseMoneyToMinor(e.target.value));
      }}
      onBlur={() => setFocused(false)}
    />
  );
}
