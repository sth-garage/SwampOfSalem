namespace GatorGazing.AppLogic.Constants;

/// <summary>
/// Visual appearance and identity constants — names, colors, accessories.
/// </summary>
public static class AppearanceConstants
{
    public static readonly string[] Names =
        ["Chomps", "Bubba", "Gnarla", "Dredge", "Murka", "Fang", "Gully", "Hiss", "Ivy", "Jaw"];

    public static readonly string[] SkinTones =
    [
        "#3a6b2a", "#5a7d1a", "#2e5040", "#6b5a30", "#4a7a6a",
        "#7a8b3a", "#8b4a2a", "#2a4a5a", "#5a3a6b", "#3a6b5a"
    ];

    public static readonly string[] HatStyles =
    [
        "tophat", "sunglasses", "wig", "bowtie", "crown",
        "bandana", "hornplate", "spines", "monocle", "crest"
    ];

    public static readonly string[] ShirtColors =
    [
        "#8baa70", "#7d9b60", "#6e8c52", "#5a7d44", "#9abb80",
        "#a0c488", "#7a9960", "#6b8a50", "#8bb470", "#90b878"
    ];

    public static readonly Dictionary<string, string>[] HouseColors =
    [
        new() { ["wall"] = "#3a7d44", ["roof"] = "#2d5a27", ["door"] = "#4a9050", ["trim"] = "#5ab860" },
        new() { ["wall"] = "#4a8b5a", ["roof"] = "#1e5631", ["door"] = "#3a7248", ["trim"] = "#6cb870" },
        new() { ["wall"] = "#5a9e60", ["roof"] = "#2d6b3a", ["door"] = "#488d55", ["trim"] = "#7cc880" },
        new() { ["wall"] = "#3e8050", ["roof"] = "#1a4d2e", ["door"] = "#357542", ["trim"] = "#5eb868" },
        new() { ["wall"] = "#4d9058", ["roof"] = "#265e35", ["door"] = "#3d7d4a", ["trim"] = "#6dc078" },
        new() { ["wall"] = "#2d7040", ["roof"] = "#1a4a28", ["door"] = "#3a6b44", ["trim"] = "#4ea860" },
        new() { ["wall"] = "#448a52", ["roof"] = "#1e5833", ["door"] = "#3a7848", ["trim"] = "#64b870" },
        new() { ["wall"] = "#3a8048", ["roof"] = "#204e2d", ["door"] = "#347040", ["trim"] = "#56b060" },
        new() { ["wall"] = "#4e9460", ["roof"] = "#2a6238", ["door"] = "#408550", ["trim"] = "#70c480" },
        new() { ["wall"] = "#388048", ["roof"] = "#1c5030", ["door"] = "#306a3c", ["trim"] = "#50a858" }
    ];
}
