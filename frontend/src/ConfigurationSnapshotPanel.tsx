import { Fragment } from 'react'
import type { SearchConfigurationWeights } from './api'
import {
  combinationTechniqueLabel,
  combinerTechniqueLabel,
  WEIGHT_CATEGORY_FIELDS,
} from './search-configuration-labels'

const DEFAULT_BUCKET_WEIGHTS = { lexical: 0.5, semantic: 0.5 }

export function ConfigurationSnapshotPanel({
  name,
  weights,
}: {
  name: string
  weights: SearchConfigurationWeights
}) {
  const bucketWeights = weights.bucket_weights ?? DEFAULT_BUCKET_WEIGHTS
  const combiner = weights.combiner

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase">Configuration</p>
        <p className="font-medium text-foreground">{name}</p>
      </div>

      <div className="space-y-3 text-xs">
        {WEIGHT_CATEGORY_FIELDS.map(({ category, fields }) => (
          <div key={category}>
            <p className="font-medium text-muted-foreground">{category}</p>
            <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-1">
              <span />
              <span className="text-muted-foreground">Main</span>
              <span className="text-muted-foreground">Variant</span>
              {fields.map((field) => (
                <Fragment key={field}>
                  <span className="capitalize">{field}</span>
                  <span className="tabular-nums">{(weights.weights[field] ?? 0).toFixed(2)}</span>
                  <span className="tabular-nums">
                    {(weights.variant_weights[field] ?? 0).toFixed(2)}
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
        ))}

        <div>
          <p className="font-medium text-muted-foreground">Bucket balance</p>
          <p>
            {Math.round((1 - (bucketWeights.semantic ?? 0.5)) * 100)}% wording ·{' '}
            {Math.round((bucketWeights.semantic ?? 0.5) * 100)}% meaning
          </p>
        </div>

        <div>
          <p className="font-medium text-muted-foreground">Combiner</p>
          {combiner ? (
            <p>
              {combinerTechniqueLabel(combiner.technique)}
              {combiner.technique === 'rrf' && ` · rank constant ${combiner.rank_constant ?? 60}`}
              {combiner.technique !== 'rrf' &&
                combiner.combination &&
                combiner.technique !== 'z_score' &&
                ` · ${combinationTechniqueLabel(combiner.combination)}`}
            </p>
          ) : (
            <p>Default</p>
          )}
        </div>
      </div>
    </div>
  )
}
