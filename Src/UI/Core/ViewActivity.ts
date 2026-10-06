import { createContext, useContext } from "react";

export const ViewActivityContext = createContext(true);
export const useViewActivity = () => useContext(ViewActivityContext);
