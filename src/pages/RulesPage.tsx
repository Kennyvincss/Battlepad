import { RulesContent } from '../components/BattleInfo';
import { makeRules } from '../lib/shared';

export function RulesPage() {
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">📜 How battles work</h1>
          <div className="page-sub">The default Classic ruleset. Every battle publishes and locks its exact rules before it starts.</div>
        </div>
      </div>
      <div className="panel panel-pad"><RulesContent rules={makeRules()} /></div>
    </div>
  );
}
