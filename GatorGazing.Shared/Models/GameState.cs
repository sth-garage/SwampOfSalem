using GatorGazing.Shared.Enums;

namespace GatorGazing.Shared.Models;

public class GameState
{
    public List<Alligator> Alligators { get; set; } = [];
    public GamePhase Phase { get; set; } = GamePhase.Day;
    public int DayNumber { get; set; } = 1;
    public int? MurdererId { get; set; }
    public HashSet<int> DeadIds { get; set; } = [];
    public int? NightVictimId { get; set; }
    public int? VoteTarget { get; set; }
    public List<int> VoteOrder { get; set; } = [];
    public int VoteIndex { get; set; }
    public Dictionary<int, int> VoteResults { get; set; } = [];
}
