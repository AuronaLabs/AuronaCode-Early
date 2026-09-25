type SaveHandler = {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
};

const handlers = new Map<string, SaveHandler>();

export const EditorSaveRegistry = {
  register(path: string, handler: SaveHandler): () => void {
    handlers.set(path, handler);
    return () => {
      if (handlers.get(path) === handler) handlers.delete(path);
    };
  },

  async save(path: string): Promise<boolean> {
    const handler = handlers.get(path);
    if (!handler) return false;
    const saved = await handler.save();
    return saved && !handler.isDirty();
  },
};
