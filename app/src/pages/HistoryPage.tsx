import { useParams } from 'react-router-dom';
import { ProjectHeader } from '../components/ProjectHeader';
import { HistoryList } from '../components/HistoryList';

export function HistoryPage() {
  const { projectId } = useParams();
  if (!projectId) return null;
  return (
    <div>
      <ProjectHeader projectId={projectId} />
      <div className="card">
        <div className="border-b px-4 py-2 font-semibold">Project history <span className="text-xs font-normal text-gray-500">(latest 500 changes; ID numbers and salaries are never stored in the log)</span></div>
        <HistoryList projectId={projectId} limit={500} />
      </div>
    </div>
  );
}
