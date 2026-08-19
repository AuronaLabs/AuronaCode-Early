import { useCallback, useState } from "react";

export interface UseEditorIMEOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onCommitText: (text: string) => void;
}

/**
 * 封装编辑器中拼音/韩文/日文等输入法（IME）合成状态与事件处理
 */
export function useEditorIME({ textareaRef, onCommitText }: UseEditorIMEOptions) {
  const [isComposing, setIsComposing] = useState(false);
  const [compositionText, setCompositionText] = useState("");

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
    setCompositionText("");
  }, []);

  const handleCompositionUpdate = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setCompositionText(e.data);
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      setIsComposing(false);
      setCompositionText("");
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
      const text = e.data;
      if (text) {
        onCommitText(text);
      }
    },
    [onCommitText, textareaRef],
  );

  const resetComposition = useCallback(() => {
    setIsComposing(false);
    setCompositionText("");
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
  }, [textareaRef]);

  return {
    isComposing,
    compositionText,
    handleCompositionStart,
    handleCompositionUpdate,
    handleCompositionEnd,
    resetComposition,
  };
}
