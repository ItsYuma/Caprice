import { useState, type FormEvent } from "react";

export type ComposerProps = {
  onSubmit: (text: string) => boolean;
};

export function Composer(props: ComposerProps) {
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (props.onSubmit(draft)) {
      setDraft("");
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="host">Say something</label>
      <input
        id="host"
        name="host"
        autoComplete="off"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      <button type="submit">Send</button>
    </form>
  );
}
