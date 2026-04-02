import type {
  CatButton,
  CatCard,
  CatCheckbox,
  CatCheckboxGroup,
  CatDatepicker,
  CatDropdown,
  CatDropdownItem,
  CatField,
  CatIcon,
  CatInput,
  CatLoading,
  CatModal,
  CatMsg,
  CatNotification,
  CatPagination,
  CatRadio,
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
  CatTooltip
} from '@interline-io/catenary'

declare module '@vue/runtime-core' {
  interface GlobalComponents {
    CatButton: typeof CatButton
    CatCard: typeof CatCard
    CatCheckbox: typeof CatCheckbox
    CatCheckboxGroup: typeof CatCheckboxGroup
    CatDatepicker: typeof CatDatepicker
    CatDropdown: typeof CatDropdown
    CatDropdownItem: typeof CatDropdownItem
    CatField: typeof CatField
    CatIcon: typeof CatIcon
    CatInput: typeof CatInput
    CatLoading: typeof CatLoading
    CatModal: typeof CatModal
    CatMsg: typeof CatMsg
    CatNotification: typeof CatNotification
    CatPagination: typeof CatPagination
    CatRadio: typeof CatRadio
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
  }
}
