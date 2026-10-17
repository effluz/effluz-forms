import type { FileIssueCode } from "../domain/in-progress";

/** A refused file as the state cookie carries it. */
export interface RefusedFileEntry {
  field: string;
  code: FileIssueCode;
  name: string;
  params: Readonly<Record<string, number>>;
}

/** What effluz_fill_state carries from a refused post to the page it redirects to; never stored. */
export interface FillPostState {
  at: number;
  page: number;
  refusedFiles: RefusedFileEntry[];
}

/** An entry as the page shows it: the field it belongs to and its localized message. */
export interface RefusedFileMessage {
  fieldKey: string;
  message: string;
}

/** `postPage` bound to the slug; it always redirects. */
export type PageFormAction = (form: FormData) => Promise<void>;
