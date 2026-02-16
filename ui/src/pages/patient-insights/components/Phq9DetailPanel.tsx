type Phq9Item = {
  question: string;
  answer: string;
  score?: number;
};

type Props = {
  show: boolean;
  emptyText: string;
  authoredText: string;
  statusText: string;
  totalScore?: number;
  items: Phq9Item[];
};

export function Phq9DetailPanel(props: Props) {
  const { show, emptyText, authoredText, statusText, totalScore, items } = props;

  if (!show) return <div className="pi-muted">{emptyText}</div>;

  return (
    <div className="pi-phq9-detail">
      <div className="pi-phq9-title">PHQ-9 Questionnaire Responses</div>
      <div className="pi-phq9-meta">{`Authored: ${authoredText} • Status: ${statusText}`}</div>
      <div className={`pi-phq9-total ${totalScore != null && totalScore >= 10 ? "flag" : ""}`}>
        {`Total Score: ${totalScore != null ? totalScore : "n/a"}`}
      </div>
      {items.length === 0 ? (
        <div className="pi-muted">No question/answer items found in linked QuestionnaireResponse.</div>
      ) : (
        <div className="pi-phq9-list">
          {items.map((qa, idx) => (
            <div
              key={`${idx}-${qa.question}`}
              className={`pi-phq9-row ${
                qa.answer === "No answer" ? "tone-none" : qa.score == null || qa.score <= 1 ? "tone-1" : qa.score === 2 ? "tone-2" : "tone-3"
              }`}
            >
              <div className="pi-phq9-q">{`Q${idx + 1}. ${qa.question}`}</div>
              <div className="pi-phq9-a">{`${qa.answer}${qa.score != null ? ` (score ${qa.score})` : ""}`}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
