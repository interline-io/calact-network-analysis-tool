import type {
  CatButton,
  CatCard,
  CatCheckbox,
  CatCheckboxGroup,
  CatDatepicker,
  CatDownloadCsv,
  CatDownloadJson,
  CatDropdown,
  CatDropdownItem,
  CatField,
  CatIcon,
  CatInput,
  CatLink,
  CatLoading,
  CatModal,
  CatMsg,
  CatNotification,
  CatPagination,
  CatRadio,
  CatSafelink,
  CatSearchBar,
  CatSelect,
  CatSlider,
  CatSliderTick,
  CatSwitch,
  CatTabItem,
  CatTable,
  CatTableColumn,
  CatTabs,
  CatTag,
  CatTaginput,
  CatTextarea,
  CatThemeToggle,
  CatTooltip,
  CatTreeControl
} from '@interline-io/catenary'

declare module '@vue/runtime-core' {
  interface GlobalComponents {
    CatButton: typeof CatButton
    CatCard: typeof CatCard
    CatCheckbox: typeof CatCheckbox
    CatCheckboxGroup: typeof CatCheckboxGroup
    CatDatepicker: typeof CatDatepicker
    CatDownloadCsv: typeof CatDownloadCsv
    CatDownloadJson: typeof CatDownloadJson
    CatDropdown: typeof CatDropdown
    CatDropdownItem: typeof CatDropdownItem
    CatField: typeof CatField
    CatIcon: typeof CatIcon
    CatInput: typeof CatInput
    CatLink: typeof CatLink
    CatLoading: typeof CatLoading
    CatModal: typeof CatModal
    CatMsg: typeof CatMsg
    CatNotification: typeof CatNotification
    CatPagination: typeof CatPagination
    CatRadio: typeof CatRadio
    CatSafelink: typeof CatSafelink
    CatSearchBar: typeof CatSearchBar
    CatSelect: typeof CatSelect
    CatSlider: typeof CatSlider
    CatSliderTick: typeof CatSliderTick
    CatSwitch: typeof CatSwitch
    CatTabItem: typeof CatTabItem
    CatTable: typeof CatTable
    CatTableColumn: typeof CatTableColumn
    CatTabs: typeof CatTabs
    CatTag: typeof CatTag
    CatTaginput: typeof CatTaginput
    CatTextarea: typeof CatTextarea
    CatThemeToggle: typeof CatThemeToggle
    CatTooltip: typeof CatTooltip
    CatTreeControl: typeof CatTreeControl
  }
}
