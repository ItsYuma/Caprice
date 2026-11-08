import type { Line } from "@caprice/core";

export type LogProps = {
  lines: readonly Line[];
  problem: string;
};

export function Log(props: LogProps) {
  return (
    <div className="log">
      {props.lines.map((line, index) => (
        <p key={index} data-who={line.who}>
          {line.text}
        </p>
      ))}
      {props.problem.length > 0 ? <p>{props.problem}</p> : null}
    </div>
  );
}
