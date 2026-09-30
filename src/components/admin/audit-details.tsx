interface AuditDetailsProps {
  oldData: unknown;
  newData: unknown;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div>
        <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
          {label}
        </p>
        <p className="text-muted-foreground text-xs">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
        {label}
      </p>
      <pre className="bg-muted max-h-48 overflow-auto rounded-md p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** Expandable old/new JSON for one audit event. */
export function AuditDetails({ oldData, newData }: AuditDetailsProps) {
  return (
    <details className="group">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-medium select-none">
        View old / new
      </summary>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <JsonBlock label="Old" value={oldData} />
        <JsonBlock label="New" value={newData} />
      </div>
    </details>
  );
}
