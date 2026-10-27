<template>
  <div class="cal-saved-geography-manager">
    <p v-if="loading && !geographies" class="help">
      <cat-icon icon="loading" size="small" />
      Loading your saved geographies...
    </p>
    <p v-else-if="error" class="help is-danger" role="alert">
      Couldn't load your saved geographies: {{ error }}
    </p>
    <p v-else-if="geographies && geographies.length === 0" class="notification">
      You haven't saved any geographies yet. On the Transit Network Explorer's Query tab, upload a GeoJSON file or select administrative boundaries, then save them.
    </p>

    <ul v-if="geographies && geographies.length > 0" class="cal-saved-geography-list">
      <li v-for="g of geographies" :key="g.id" class="cal-saved-geography-row">
        <button
          type="button"
          class="cal-saved-geography-star"
          :class="{ 'is-favorite': isFavorite(g) }"
          :disabled="!access?.update || busy.has(g.id)"
          :aria-pressed="isFavorite(g)"
          :aria-label="isFavorite(g) ? `Remove ${g.name} from favorites` : `Add ${g.name} to favorites`"
          :title="isFavorite(g) ? 'Favorite: listed first' : 'Add to favorites'"
          @click="toggleFavorite(g)"
        >
          <cat-icon :icon="isFavorite(g) ? 'star' : 'star-outline'" />
        </button>

        <div class="cal-saved-geography-name">
          <form v-if="renaming === g.id" class="cal-saved-geography-rename" @submit.prevent="saveRename(g)">
            <cat-input v-model="renameText" :maxlength="200" v-bind="{ ariaLabel: `New name for ${g.name}` }" />
            <cat-button size="small" variant="primary" :loading="busy.has(g.id)" @click="saveRename(g)">
              Save
            </cat-button>
            <cat-button size="small" @click="renaming = ''">
              Cancel
            </cat-button>
          </form>
          <template v-else>
            <strong>{{ g.name }}</strong>
            <cat-button
              v-if="access?.update"
              variant="ghost"
              size="small"
              icon-left="pencil"
              v-bind="{ ariaLabel: `Rename ${g.name}` }"
              @click="startRename(g)"
            />
            <p class="help">
              {{ describe(g) }}
            </p>
          </template>
        </div>

        <div class="cal-saved-geography-actions">
          <cat-button size="small" @click="load(g)">
            Load
          </cat-button>
          <cat-button
            v-if="access?.download"
            size="small"
            icon-left="download"
            :loading="downloading === g.id"
            @click="download(g)"
          >
            Download
          </cat-button>
          <cat-button v-if="access?.delete" size="small" variant="danger" outlined @click="deleting = g">
            Delete
          </cat-button>
        </div>
      </li>
    </ul>
    <p v-if="actionError" class="help is-danger" role="alert">
      {{ actionError }}
    </p>
    <p v-if="manageUrl" class="help mt-3">
      Saved geographies are kept in your Interline account. You can also download or delete them, along with anything else you've stored, on
      <a :href="manageUrl" target="_blank" rel="noopener">your account's Assets page<span class="is-sr-only"> (opens in a new tab)</span></a>.
    </p>

    <cat-modal
      :model-value="!!deleting"
      title="Delete saved geography"
      size="small"
      @update:model-value="deleting = $event ? deleting : null"
    >
      <p>Delete "{{ deleting?.name }}" from your profile? This can't be undone. Download it first to keep a copy.</p>
      <template #footer>
        <div class="buttons">
          <cat-button variant="danger" :loading="!!deleting && busy.has(deleting.id)" @click="confirmDelete">
            Delete
          </cat-button>
          <cat-button @click="deleting = null">
            Cancel
          </cat-button>
        </div>
      </template>
    </cat-modal>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import { useDownload } from '@interline-io/catenary'
import { fmtDate, isAdminBoundaryDocument, isFavorite, type SavedGeography } from '~~/src/core'
import { geographyLayerQuery } from '~~/src/tl/census'
import { savedGeographyErrorMessage, useSavedGeographies } from '~/composables/useSavedGeographies'

// The user's saved geographies, to star, rename, load into a query, download
// or delete. Self-contained: it reads and writes them itself.

const { access, geographies, loading, error, manageUrl, ensureLoaded, get, rename, setFavorite, remove } = useSavedGeographies()
onMounted(() => { void ensureLoaded() })

const busy = reactive(new Set<string>())
const actionError = ref('')

async function act (g: SavedGeography, what: string, fn: () => Promise<unknown>) {
  busy.add(g.id)
  actionError.value = ''
  try {
    await fn()
  } catch (e) {
    actionError.value = `Couldn't ${what} "${g.name}": ${savedGeographyErrorMessage(e)}`
  } finally {
    busy.delete(g.id)
  }
}

function describe (g: SavedGeography): string {
  const n = g.metadata.feature_count
  const what = g.metadata.source === 'admin_boundary'
    ? `${n ?? 'Some'} administrative ${n === 1 ? 'boundary' : 'boundaries'}`
    : `${n ?? 'Some'} ${n === 1 ? 'feature' : 'features'} uploaded${g.metadata.filename ? ` from ${g.metadata.filename}` : ''}`
  return `${what} · saved ${fmtDate(new Date(g.created_at), 'MMM d, yyyy')}`
}

function toggleFavorite (g: SavedGeography) {
  void act(g, 'star', () => setFavorite(g, !isFavorite(g)))
}

const renaming = ref('')
const renameText = ref('')
function startRename (g: SavedGeography) {
  renaming.value = g.id
  renameText.value = g.name
}
function saveRename (g: SavedGeography) {
  const name = renameText.value.trim()
  if (!name || name === g.name) {
    renaming.value = ''
    return
  }
  void act(g, 'rename', async () => {
    await rename(g, name)
    renaming.value = ''
  })
}

function load (g: SavedGeography) {
  void navigateTo({ path: '/tne', query: { geomSource: 'custom', savedGeographies: g.id } })
}

// A saved boundary set is kept as references, so its download fetches the
// boundaries' outlines to make a file anyone can upload
const { resolveClient } = useApolloClient()
const downloading = ref('')
function download (g: SavedGeography) {
  downloading.value = g.id
  void act(g, 'download', async () => {
    try {
      const saved = await get(g.id)
      let geojson: unknown = saved.content
      if (isAdminBoundaryDocument(saved.content)) {
        const doc = saved.content
        const resp = await resolveClient().query<{ census_datasets: { geographies: { id: number, geoid: string, name: string, geometry: GeoJSON.Geometry, layer: { name: string } }[] }[] }>({
          query: geographyLayerQuery,
          variables: { geography_ids: doc.geographies.map(x => x.id), include_geographies: true, dataset_name: doc.dataset },
        })
        const found = resp.data?.census_datasets?.[0]?.geographies || []
        geojson = {
          type: 'FeatureCollection',
          features: found.map(x => ({
            type: 'Feature',
            properties: { name: x.name, geoid: x.geoid, layer: x.layer?.name, dataset: doc.dataset },
            geometry: x.geometry,
          })),
        }
      }
      const filename = `${g.name.replace(/[\\/:*?"<>|]+/g, '_')}.geojson`
      useDownload().download({ filename, data: JSON.stringify(geojson), mimeType: 'application/geo+json' })
    } finally {
      downloading.value = ''
    }
  })
}

const deleting = ref<SavedGeography | null>(null)
function confirmDelete () {
  const g = deleting.value
  if (!g) {
    return
  }
  void act(g, 'delete', async () => {
    await remove(g)
    deleting.value = null
  })
}
</script>

<style scoped lang="scss">
.cal-saved-geography-list {
  list-style: none;
  margin: 0;
}

.cal-saved-geography-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--bulma-border-weak, #ededed);
}

.cal-saved-geography-star {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--bulma-grey);
  &.is-favorite {
    color: #e6a700;
  }
  &:disabled {
    cursor: default;
  }
}

.cal-saved-geography-name {
  flex: 1;
  min-width: 0;
}

.cal-saved-geography-rename {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.cal-saved-geography-actions {
  display: flex;
  gap: 0.25rem;
}
</style>
