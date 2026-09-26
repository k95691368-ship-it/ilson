import { expect, it } from 'vitest'
import { encodeBetaNote, decodeBetaRound } from '../shared/betaEvidence.js'
it('preserves original notes and does not interpret client text as revision metadata',()=>{
  const forged=encodeBetaNote(999,'pretend')
  expect(decodeBetaRound({note:encodeBetaNote(4,forged)})).toEqual({note:forged,criteriaRevision:4})
  for(const note of [null,'plain historical note','{broken']) expect(decodeBetaRound({note})).toEqual({note,criteriaRevision:null})
})
it('rejects overflow before database truncation can corrupt metadata or original text',()=>{
  expect(encodeBetaNote(1,'x'.repeat(10000))).toBeNull()
  expect(encodeBetaNote(1,'"'.repeat(5000))).toBeNull()
  const note='원본 "의견"\n내용'
  expect(decodeBetaRound({note:encodeBetaNote(7,note)})).toMatchObject({note,criteriaRevision:7})
})
