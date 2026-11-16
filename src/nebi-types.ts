/**
 * Fields consumed from Nebi's Job response. The backend also defines cancelled.
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/frontend/src/types/models.ts#L69-L80
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/internal/models/job.go#L27-L47
 */
export interface INebiJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

/**
 * Fields consumed from Nebi's Workspace response.
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/frontend/src/types/models.ts#L26-L42
 */
export interface INebiWorkspace {
  id: string;
  path?: string;
}

/**
 * Fields consumed from Nebi's GET /version response.
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/internal/api/handlers/version.go#L110-L133
 */
export interface INebiServerVersion {
  mode: string;
}

/**
 * Fields consumed from Nebi's WorkspaceVersion response.
 * @see https://github.com/nebari-dev/nebi/blob/5bf66de578662296d92093d57f462840dec910cd/frontend/src/types/models.ts#L138-L150
 */
export interface INebiWorkspaceVersion {
  version_number: number;
  job_id?: string;
}
