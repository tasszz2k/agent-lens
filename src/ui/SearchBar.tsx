import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface SearchBarProps {
  active: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: (clearQuery?: boolean) => void;
}

export default function SearchBar({
  active,
  query,
  onQueryChange,
  onClose,
}: SearchBarProps) {
  const [showCursor, setShowCursor] = useState(true);

  useInput(
    (input, key) => {
      if (!active) return;
      if (key.escape) {
        onClose(true);
        return;
      }
      if (key.return) {
        onClose(false);
        return;
      }
      if (key.backspace) {
        onQueryChange(query.slice(0, -1));
        return;
      }
      if (input.length > 0 && !key.ctrl && !key.meta) {
        onQueryChange(query + input);
      }
    },
    { isActive: active }
  );

  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setShowCursor((s) => !s), 500);
    return () => clearInterval(id);
  }, [active]);

  if (!active && query.length === 0) return null;
  if (!active)
    return (
      <Box>
        <Text dimColor>Filter: </Text>
        <Text dimColor>{query}</Text>
      </Box>
    );

  return (
    <Box>
      <Text>/ </Text>
      <Text>{query}</Text>
      <Text>{showCursor ? '_' : ' '}</Text>
    </Box>
  );
}
