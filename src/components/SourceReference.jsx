// A short suffix distinguishes same-name inputs in dense tables. Full hashes
// remain available in the disclosure/export; a hash is not proof of accuracy.
export function SourceFile({ source }) {
  if (!source) return null
  return <span>{source.file}{source.ambiguousName && source.sha256 && <small className="card-note" title={`SHA-256 ${source.sha256}`}> · {source.sha256.slice(0, 12)}</small>}</span>
}

export default function SourceReferences({ files, localOnly = true }) {
  const unique = new Map()
  for (const file of files ?? []) {
    const key = JSON.stringify([file.name, file.sha256 ?? null, Boolean(file.skippedDuplicate)])
    if (!unique.has(key)) unique.set(key, file)
  }
  if (!unique.size) return null
  return <details className="disclose">
    <summary>원본 파일 구분 · {unique.size}개</summary>
    <div className="disclose-body">
      <p className="card-note">SHA-256은 넣은 파일 내용의 식별값이며 금액의 정확성이나 승인을 뜻하지 않습니다.{localOnly && ' 이 목록은 현재 브라우저의 실행 결과이며 화면을 나가거나 새로고침하면 사라집니다.'}</p>
      <ul className="stack-sm">
        {[...unique.entries()].map(([key, file]) => <li key={key}>
          <SourceFile source={{ file: file.name, sha256: file.sha256, ambiguousName: file.ambiguousName }} />
          {file.sha256 ? <div><span className="card-note">SHA-256 </span><code>{file.sha256}</code></div> : <div className="card-note">이 기록에는 원본 지문이 없습니다.</div>}
          {file.skippedDuplicate && <p className="card-note">내용이 같아 한 번만 계산했습니다. 기준 파일: {file.duplicateOf?.file ?? '기존 기록 참조'}</p>}
        </li>)}
      </ul>
    </div>
  </details>
}
